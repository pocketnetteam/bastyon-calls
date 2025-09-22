import { EventEmitter } from "events";
import "./scss/index.sass";

const CallTypes = {
  video: "video",
  voice: "voice",
};

const isVideoCall = (callType) => callType === CallTypes.video;

class BastyonCalls extends EventEmitter {
  constructor(client, matrixcs, root, options) {
    super();
    this.client = client;
    this.matrixcs = matrixcs;
    this.initEvents();
    this.initSignals();
    this.initTemplates(root);
    /*this.initCordovaPermisions()*/ /// TODO
    this.options = options;
    this.initAudioEventListeners();
    // this.initCallKitIntegration();
    console.log("ss", client, matrixcs);
    console.log("dd", matrixcs);
  }

  controls = {};
  isFrontalCamera = false;
  videoStreams = null;
  isMuted = false;
  isScreenSharing = false;
  isCompositeActive = false;
  screenStream = null;
  cameraStream = null;
  originalVideoTrack = null;
  compositeCanvas = null;
  cameraVideoElement = null;
  screenVideoElement = null;
  activeCall = null;
  secondCall = null;
  syncInterval = null;
  isWaitingForConnect = false;
  signal = null;
  timer = null;
  timeInterval = null;
  title = null;
  destroyed = false;
  view = "middle";

  setupCallKit() {
    if (window.cordova?.plugins?.CordovaCall) {
      console.log("CallKit plugin found!");

      try {
        window.cordova?.plugins?.CordovaCall.setAppName(
          "Bastyon",
          () => console.log("App name set"),
          (err) => console.error("App name error:", err),
        );
        window.CordovaCall.setIncludeInRecents(
          true,
          () => console.log("Include in recents enabled"),
          (err) => console.error("Include in recents error:", err),
        );

        window.cordova.plugins.CordovaCall.on("answer", (data) => {
          console.log("CallKit answered:", data);
          this.handleCallKitAnswer(data);
        });

        window.cordova.plugins.CordovaCall.on("reject", (data) => {
          console.log("CallKit rejected:", data);
          this.handleCallKitReject(data);
        });

        window.cordova.plugins.CordovaCall.on("hangup", (data) => {
          console.log("CallKit hangup:", data);
          this.handleCallKitHangup(data);
        });

        console.log("CallKit initialized successfully");
        this.callKitPlugin = window.cordova.plugins.CordovaCall;
      } catch (error) {
        console.error("CallKit initialization error:", error);
      }
    } else {
      console.log("CallKit plugin not found");
      console.log(
        "Available globals:",
        Object.keys(window).filter(
          (k) => k.includes("Call") || k.includes("cordova"),
        ),
      );
    }
  }

  async getAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        speakers: devices.filter((device) => device.kind === "audiooutput"),
        microphones: devices.filter((device) => device.kind === "audioinput"),
      };
    } catch (error) {
      console.error("Error getting audio devices:", error);
      return { speakers: [], microphones: [] };
    }
  }

  async setMicrophoneInput(deviceId) {
    try {
      if (!this.activeCall) return false;

      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newAudioTrack = newStream.getAudioTracks()[0];

      const senders = this.activeCall.peerConn.getSenders();
      const audioSender = senders.find(
        (sender) => sender.track && sender.track.kind === "audio",
      );

      if (audioSender) {
        await audioSender.replaceTrack(newAudioTrack);

        if (audioSender.track) {
          audioSender.track.stop();
        }

        localStorage.setItem("preferredMicrophoneInput", deviceId || "default");
        console.log("Microphone changed to:", deviceId || "default");
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error setting microphone:", error);
      this.showAudioError("Failed to change microphone");
      return false;
    }
  }

  showAudioError(message) {
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: rgb(var(--color-bad));
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          z-index: 999999;
          font-size: 14px;
      `;
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);

    setTimeout(() => errorDiv.remove(), 3000);
  }

  async setAudioOutput(deviceId) {
    try {
      console.log("Trying to set audio output to:", deviceId);

      const remoteVideo = document.getElementById("remote");
      const localVideo = document.getElementById("local");

      if (remoteVideo && typeof remoteVideo.setSinkId === "function") {
        try {
          await remoteVideo.setSinkId(deviceId);
          console.log("Remote video sink set successfully");
        } catch (e) {
          console.error("Failed to set remote sink:", e);
          throw e;
        }
      }

      if (localVideo && typeof localVideo.setSinkId === "function") {
        try {
          await localVideo.setSinkId(deviceId);
          console.log("Local video sink set successfully");
        } catch (e) {
          console.warn("Failed to set local sink:", e);
        }
      }

      const audioElements = document.querySelectorAll("audio");
      for (let audio of audioElements) {
        if (typeof audio.setSinkId === "function") {
          try {
            await audio.setSinkId(deviceId);
          } catch (e) {
            console.warn("Failed to set audio sink:", e);
          }
        }
      }

      localStorage.setItem("preferredAudioOutput", deviceId || "default");
      console.log(
        "Audio output successfully changed to:",
        deviceId || "default",
      );
      return true;
    } catch (error) {
      console.error("Error setting audio output:", error);
      this.showAudioError("Failed to change audio output");
      return false;
    }
  }

  initAudioEventListeners() {
    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }

    navigator.mediaDevices.addEventListener("devicechange", async () => {
      try {
        const devices = await this.getAudioDevices();

        if (window.isios && window.isios()) {
          return;
        }

        if (window.cordova?.plugins?.audioManagement && this.activeCall) {
          try {
            await window.cordova.plugins.audioManagement.configureAudioSession({
              category: "playAndRecord",
              mode: "voiceChat",
              options: ["allowBluetooth", "allowBluetoothA2DP"],
            });
          } catch (error) {
            console.error("Cordova audio config failed:", error);
          }
          return;
        }

        const bluetoothDevice = devices.speakers.find((device) => {
          const label = device.label.toLowerCase();
          return (
            label.includes("bluetooth") ||
            label.includes("airpod") ||
            label.includes("airbuds") ||
            label.includes("wh-") ||
            label.includes("buds") ||
            label.includes("headset") ||
            label.includes("headphone")
          );
        });

        const wiredHeadphone = devices.speakers.find((device) => {
          const label = device.label.toLowerCase();
          return (
            label.includes("headphone") ||
            label.includes("headset") ||
            label.includes("wired") ||
            label.includes("3.5mm")
          );
        });

        const preferredDevice = bluetoothDevice || wiredHeadphone;

        if (preferredDevice && this.activeCall) {
          await this.setAudioOutput(preferredDevice.deviceId);

          const micDevice = devices.microphones.find(
            (mic) =>
              mic.groupId === preferredDevice.groupId ||
              mic.label
                .toLowerCase()
                .includes(preferredDevice.label.toLowerCase().split(" ")[0]),
          );

          if (micDevice) {
            await this.setMicrophoneInput(micDevice.deviceId);
          }
        }
      } catch (error) {
        console.error("Error handling device change:", error);
      }
    });
  }

  templates = {
    incomingCall: function (call) {
      const _isVideoCall = isVideoCall(call.type);
      const callTypeDescriptionKey = _isVideoCall
        ? "incomingVideoCall"
        : "incomingAudioCall";
      return `
			<div class="bc-incoming-call">
				<div class="user">
					<div class="avatar">
						${this.getAvatar(call)}
					</div>
					<div class="title">
						<div class="name">${call.initiator.source.name}</div>
						<div class="description">${this.options.getWithLocale(
              callTypeDescriptionKey,
            )}</div>
					</div>
				</div>
				<div class="buttons">
					<button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
					${
            !!_isVideoCall
              ? '<button class="bc-btn bc-answer" id="bc-answer-video"><i class="fa fa-video"></i></button>'
              : ""
          }
					<button class="bc-btn bc-answer " id="bc-answer-voice"><i class="fas fa-flip-horizontal fa-phone"></i></button>

				</div>
			</div>
		`;
    },
    endedCall: function (call) {
      return `
			<div class="bc-ended-call">
				<div class="avatar">
						${this.getAvatar(call)}
				</div>
				<div class="name">${this.activeCall.initiator.source.name}</div>
				<div class="description">${this.options.getWithLocale("endedCall")}</div>
			</div>`;
    },

    videoCall: function () {
      return `
        <div class="bc-topnav">
          <div class="bc-call-info">
            <div class="avatar">
              ${this.getAvatar()}
            </div>
            <div class="info">
              <div class="name">${this.activeCall.initiator.source.name}</div>
              <div class="time" id="time">0:00</div>
            </div>
          </div>
          <div class="options">
            <button class="bc-btn bc-pip" id="bc-pip"><i class="fas fa-minus"></i></button>
            <button class="bc-btn bc-format" id="bc-format"><i class="fas"></i></button>
          </div>
        </div>
        <div class="bc-video-container">
          <div class="bc-video active novid" id="remote-scene">
            <video id="remote" pip="false" autoplay disablePictureInPicture="true" playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
            <div class="avatar">
              ${this.getAvatar()}
            </div>
            <div class="status">${this.options.getWithLocale("connecting")}</div>
          </div>
          <div class="bc-video minified" id="local-video">
            <video id="local" muted pip="false" disablePictureInPicture="true" autoplay playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
            <div class="resize-handle nw"></div>
            <div class="resize-handle ne"></div>
            <div class="resize-handle sw"></div>
            <div class="resize-handle se"></div>
          </div>
        </div>
        <div class="bc-controls" data-call-type="video" id="controls">
          <button disabled class="bc-btn bc-camera" id="bc-camera"><i class="fas fa-sync-alt"></i></button>
          <button disabled class="bc-btn bc-screen-share" id="bc-screen-share" title="Screen Share"><i class="fas fa-desktop"></i></button>
          <button class="bc-btn bc-video-on call-update-control" disabled id="bc-video-on"><i class="fas fa-video"></i></button>
          <button class="bc-btn bc-video-off call-update-control" id="bc-video-off"><i class="fas fa-video-slash"></i></button>
          <div class="bc-control-group">
            <div class="bc-device-selector">
              <button class="bc-btn bc-mute" id="bc-mute" title="Microphone"><i class="fas fa-microphone"></i></button>
            </div>
            <button class="bc-selector-button" id="bc-audio-selector" title="Audio Settings">
              <i class="fas fa-chevron-up"></i>
            </button>
          </div>
          <button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
          <button class="bc-btn bc-expand" id="bc-expand"><i class="fas fa-expand"></i></button>
        </div>
      `;
    },
    voiceCall: function () {
      return `<div class="bc-topnav">
        <div class="bc-call-info">
          <div class="avatar">
            ${this.getAvatar()}
          </div>
          <div class="info">
            <div class="name">${this.activeCall.initiator.source.name}</div>
            <div class="time" id="time">0:00</div>
          </div>
        </div>
        <div class="options">
          <button class="bc-btn bc-pip" id="bc-pip"><i class="fas fa-minus"></i></button>
          <button class="bc-btn bc-format" id="bc-format"><i class="fas"></i></button>
        </div>
      </div>
      <div class="bc-video-container">
        <div class="bc-video active novid" id="remote-scene">
          <video id="remote" pip="false" autoplay playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
          <div class="avatar">
            ${this.getAvatar()}
          </div>
          <div class="status">${this.options.getWithLocale("connecting")}</div>
        </div>
        <div class="bc-video minified" id="local-video-voice">
          <video id="local" class="hidden" muted pip="false" autoplay playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
          <div class="resize-handle nw"></div>
          <div class="resize-handle ne"></div>
          <div class="resize-handle sw"></div>
          <div class="resize-handle se"></div>
        </div>
      </div>
      <div data-call-type="voice" class="bc-controls voice" id="controls">
        <button class="bc-btn bc-camera" disabled id="bc-camera"><i class="fas fa-sync-alt"></i></button>
        <button class="bc-btn bc-video-on call-update-control" id="bc-video-on"><i class="fas fa-video"></i></button>
        <button class="bc-btn bc-video-off call-update-control" disabled id="bc-video-off"><i class="fas fa-video-slash"></i></button>
        <div class="bc-control-group">
          <div class="bc-device-selector">
            <button class="bc-btn bc-mute" id="bc-mute" title="Microphone"><i class="fas fa-microphone"></i></button>
          </div>
          <button class="bc-selector-button" id="bc-audio-selector" title="Audio Settings">
            <i class="fas fa-chevron-up"></i>
          </button>
        </div>
        <button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
        <button class="bc-btn bc-expand" id="bc-expand"><i class="fas fa-expand"></i></button>
      </div>
    `;
    },
  };

  renderTemplates = {
    /**
     * @param {keyof CallTypes} callType
     */
    call: (type) => {
      if (!this.root) return;

      const controls = document.getElementById("controls");
      const existingCallTemplate = !!controls;
      const _isVideoCall = isVideoCall(type);

      // Update elements without re-rendering the entire call template
      if (existingCallTemplate) {
        const cameraButton = document.getElementById("bc-camera");
        const localVideo = document.getElementById("local");

        controls.dataset.callType = type;
        if (cameraButton) cameraButton.disabled = !_isVideoCall;
        if (localVideo) localVideo.classList.toggle("hidden", !_isVideoCall);
      } else {
        const callTemplate = this.templates[`${type}Call`];
        if (!callTemplate) throw Error(`No template for ${type}`);

        this.root.innerHTML = callTemplate?.call(this) || "";
        this.initCallInterface(`videoCall`);
      }
    },
    incomingCall: (call) => {
      if (!this.notify) return;

      if (
        this?.activeCall?.state === "ringing" &&
        this?.activeCall?.callId !== call.callId
      ) {
        call.reject("busy");
        return;
      }
      this.notify.innerHTML =
        this.templates["incomingCall"]?.call(this, call) || "";
      this.initCallInterface("incomingCall", call);
    },
    clearNotify: () => {
      if (!this.notify) return;

      // console.log('clearNotify')
      this.notify.innerHTML = "";
    },
    clearVideo: () => {
      if (!this.root) return;

      this.root.innerHTML = "";
    },
    clearInterface: () => {
      if (!this.root) return;

      this.root.classList.remove("active");
      this.cancelMini();
      this.root.classList.remove("middle");
      this.root.classList.remove("full");
    },
    endedCall: (call) => {
      if (!this.root) return;

      if (this.root.classList.contains("minified")) {
        this.cancelMini();
      }

      this.root.innerHTML = this.templates["endedCall"]?.call(this, call) || "";
    },
  };

  destroy() {
    this.destroyed = true;

    if (this.activeCall) this.activeCall.hangup();
    if (this.secondCall) this.secondCall.hangup();

    if (this.isScreenSharing) {
      this.stopScreenShare();
    }

    this.clearTimer();
    this.clearBlinking();
    clearInterval(this.syncInterval);

    this.signal?.pause();
    this.signal = null;

    this.renderTemplates.clearInterface();
    this.renderTemplates.clearVideo();
    this.renderTemplates.clearNotify();

    if (this.container) this.container.remove();

    this.container = null;
    this.root = null;
    this.notify = null;
  }

  initTemplates(outerRoot) {
    // console.log(outerRoot)
    outerRoot.insertAdjacentHTML(
      "beforeend",
      `<div class="bc-container" id="bc-container"><div id="bc-notify" class="bc-notify"></div><div id="bc-root"></div></div>`,
    );

    this.root = document.getElementById("bc-root");
    this.notify = document.getElementById("bc-notify");
    this.container = document.getElementById("bc-container");

    if (window) {
      window.onbeforeunload = () => {
        if (this.activeCall) {
          this.activeCall.hangup();
        }
      };
    }
  }

  initEvents() {
    this.client.on("Call.incoming", async (call) => {
      if (call.state == "fledgling") {
        await pretry(() => {
          return call.state != "fledgling";
        }, 50);
      }

      if (call.hangupParty || call.hangupReason) {
        return;
      }

      this.clearBlinking();
      this.setBlinking();
      this.emit("initcall");

      if (this?.options?.onIncomingCall) {
        this.options.onIncomingCall(call);
      }

      let members = this.client.store.rooms[call.roomId].currentState.members;
      let initiatorId = Object.keys(members).filter(
        (m) => m !== this.client.credentials.userId,
      );
      let initiator = members[initiatorId];
      let user = members[this.client.credentials.userId];
      // console.log('new call ', call)
      call.initiator = initiator;
      call.user = user;
      this.options.getUserInfo(initiator.userId).then((res) => {
        // console.log('user opt', res)
        if (call.hangupParty || call.hangupReason) {
          return;
        }
        initiator.source = res[0] || res;
        this.addCallListeners(call);
        if (!this.activeCall) {
          // console.log('no active')
          this.activeCall = call;
        } else if (!this.secondCall) {
          // console.log('no second')
          this.secondCall = call;
          if (this.activeCall.state !== "ringing") {
            this.showIncomingCall(call);

            return;
          }
        } else {
          // console.log('no place 1', call.state)
          call.reject("busy");
          // console.log('no place 2', call.state)
          call.hangup("busy");
          // console.log('no place 3', call.state)

          // console.log('all calls', this)
        }

        this.showIncomingCall(call);
      });
    });
  }

  initSignals() {
    this.signal = new Audio();
  }
  clearTimer() {
    this.timer = null;
    clearInterval(this.timeInterval);
    this.timeInterval = null;
  }

  initTimer() {
    this.timer = 0;
    let el = document.getElementById("time");
    this.timeInterval = setInterval(
      function () {
        this.timer++;
        let m = Math.floor(this.timer / 60);
        let s = this.timer % 60;
        el.innerHTML = `${m}:${s >= 10 ? s : "0" + s}`;
      }.bind(this),
      1000,
    );
  }

  /**
   * @param {keyof CallTypes} callType
   */
  answer(callType = CallTypes.video) {
    const _isVideoCall = isVideoCall(callType);
    this.signal?.pause();

    const answerActiveCall = () => this.activeCall.answer(true, _isVideoCall);
    this.initCordovaPermisions(callType)
      .then(() => {
        try {
          if (
            this.activeCall.state !== "connected" &&
            this.activeCall.state !== "ended"
          ) {
            answerActiveCall();
            this.renderTemplates.clearNotify();
            this.renderTemplates.call(callType);
          } else {
            this.isWaitingForConnect = true;
            this.renderTemplates.clearNotify();
            this.activeCall.hangup();
            setTimeout(() => {
              if (this.destroyed) return;

              try {
                answerActiveCall();
                this.isWaitingForConnect = false;
                this.renderTemplates.call(callType);
              } catch (e) {
                console.error("Ошибка при ответе на вторую линию", e);
              }
            }, 1000);
          }
        } catch (e) {
          return Promise.reject(e);
        }

        return Promise.resolve();
      })
      .catch((e) => {
        console.error(e);
      });
  }

  initsync() {
    let container = document.querySelector(".bc-video-container");

    this.activeCall.peerConn.getStats(null).then((stats) => {
      let filtered = [...stats].filter((r) => {
        return r[1].type === "candidate-pair";
      });
      filtered.forEach((c) => {
        // console.log(stats.get(c.selectedCandidatePairId))
      });
    });

    var inited = false;

    if (this.syncInterval) clearInterval(this.syncInterval);

    this.syncInterval = setInterval(() => {
      if (this?.activeCall?.remoteUsermediaStream) {
        let track = this.activeCall?.remoteUsermediaStream?.getVideoTracks()[0];
        let aspectRatio = track?.getSettings().aspectRatio ?? 1.3;
        const isVoiceCall = !track;

        /*var hastrack = _.filter(this.activeCall.remoteUsermediaStream.getVideoTracks(), t => {
					return t.readyState == 'live' && t.getSettings().aspectRatio
				}).length + _.filter(this.activeCall.remoteUsermediaStream.getAudioTracks(), t => {
					console.log("T" ,t, t.readyState, t.getSettings())
					return t.readyState == 'live'
				}).length

				console.log('hastrack', hastrack)*/

        if (
          isVoiceCall ||
          (track && aspectRatio) ||
          (window.isios && window.isios())
        ) {
          if (!inited) {
            const remoteScene = document.getElementById("remote-scene");
            if (!isVoiceCall) {
              remoteScene.classList.remove("novid");
            } else {
              remoteScene.classList.add("novid");
            }
            remoteScene.classList.remove("connecting");
          }

          inited = true;
        }

        if (aspectRatio) {
          container.style.aspectRatio = 1 / aspectRatio;

          if (aspectRatio > 1) {
            container.classList.add("vertical");
          } else {
            container.classList.remove("vertical");
          }

          return;
        } else {
          if (container.style.aspectRatio != 1) container.style.aspectRatio = 1;
        }
      }
    }, 300);
  }

  // play(e){
  // 	e.target.play().catch(console.log)
  // }

  mute(e) {
    e.stopPropagation();

    let sender = this.activeCall.peerConn.getSenders().find((s) => {
      return s.track.kind === "audio";
    });

    let control = document.querySelector(".bc-mute");
    if (sender.track.enabled) {
      control.firstChild.classList.remove("fa-microphone");
      control.classList.add("active");
      control.firstChild.classList.add("fa-microphone-slash");
    } else {
      control.firstChild.classList.remove("fa-microphone-slash");
      control.classList.remove("active");
      control.firstChild.classList.add("fa-microphone");
    }
    sender.track.enabled = !sender.track.enabled;

    // console.log('mute',this.activeCall.peerConn.getSenders())
  }
  async handleCallUpdate(actionCallback) {
    this.setCallUpdateControlsLoading(true);

    try {
      await actionCallback();
    } finally {
      this.setCallUpdateControlsLoading(false);
    }
  }
  setCallUpdateControlsLoading(isLoading) {
    const elements = document.querySelectorAll(".call-update-control");
    elements.forEach((element) => {
      element.disabled = isLoading;
      element.classList.toggle("loading", isLoading);
    });
  }
  updateCall = async (callType) => {
    await this.handleCallUpdate(async () => {
      const isVideoCallEnabled = isVideoCall(callType);

      if (isVideoCallEnabled) {
        await this.activeCall.upgradeCall(true, true);
      } else {
        this.activeCall.setLocalVideoMuted(true);
      }

      this.renderTemplates.call(callType);

      if (this.isScreenSharing && this.screenStream) {
        this.updateInterfaceForScreenShare(this.screenStream);
      }

      setTimeout(() => {
        const minifiedVideos = document.querySelectorAll(".bc-video.minified");
        minifiedVideos.forEach((element) => {
          this.updateVideoBorder(element);
        });
      }, 100);
    });
  };
  hide(e) {
    e.stopPropagation();
    let sender = this.activeCall.peerConn.getSenders().find((s) => {
      return s.track?.kind === "video" || !s.track;
    });

    if (sender.track.enabled) {
    } else {
    }

    sender.track.enabled = !sender.track.enabled;
    // console.log('hide',this.activeCall.peerConn.getSenders(), this.activeCall.peerConn.getReceivers())
    // console.log('remote tracks',this.activeCall.remoteStream.getTracks())
  }

  cameraCount() {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      let cameras = devices.filter((d) => d.kind === "videoinput");
      // console.log(cameras)
      if (cameras.length <= 1) {
        document.getElementById("bc-camera").style.display = "none";
        // console.log('no cameras')
      }
    });
  }

  async getVideoDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "videoinput");
    } catch (error) {
      console.error("Error getting video devices:", error);
      return [];
    }
  }

  devices() {
    return navigator.mediaDevices.enumerateDevices().then((devices = []) => {
      if (window.cordova && window.cordova.plugins.EnumerateDevicesPlugin) {
        return cordova.plugins.EnumerateDevicesPlugin.getEnumerateDevices().then(
          (cdevices = []) => {
            var usedids = {};
            var rdevices = [];

            cdevices.reverse();
            console.log("cdevices", cdevices);
            console.log("devices", devices);
            devices.forEach((device) => {
              var clone = {
                deviceId: device.deviceId,
                groupId: device.groupId,
                kind: device.kind,
                label: device.label,
              };

              var match = cdevices.find((d, i) => {
                return clone.kind == d.kind && !usedids[d.deviceId];
              });

              if (match) {
                usedids[match.deviceId] = true;

                if (!clone.label) {
                  clone.label = (match.label || "").toLowerCase();
                }
              }

              rdevices.push(clone);
            });
            console.log(rdevices);
            return Promise.resolve(rdevices);
          },
        );
      }

      return Promise.resolve(devices);
    });
  }

  camera(e) {
    let self = this;

    try {
      this.devices()
        .then((dev) => {
          console.log("devices", dev);

          let video = dev.filter((d) => d.kind === "videoinput");
          let target;
          const senders = self.activeCall.peerConn.getSenders();
          // console.log('senders', senders)
          let sender = senders.find((s) => {
            return s.track.kind === "video";
          });
          // console.log('sender', sender)

          console.log("video", video);

          /*if (sender && sender?.label?.includes('front' || 'передней')){
				// console.log('Front camera is active')
				self.isFrontalCamera = true
			}*/
          // console.log('video list', video)

          console.log("sender", sender);

          if (!sender) return;

          if (video.length > 1) {
            if (
              sender.track.label.includes("front") ||
              sender.track.label.includes("передней")
            ) {
              console.log("to back");
              target = video.reverse().find((device) => {
                return (
                  device.label.includes("back") ||
                  device.label.includes("задней")
                );
              });
            } else if (
              sender.track.label.includes("back") ||
              sender.track.label.includes("задней")
            ) {
              console.log("to front");
              target = video.find((device) => {
                return (
                  device.label.includes("front") ||
                  device.label.includes("передней")
                );
              });
            } else {
              console.log("no labeled");
              target = video.find((device) => {
                return device.label !== sender.track.label;
              });
            }
          } else return;

          console.log("target", target);

          if (!target) return;

          let videoConstraints = {};
          videoConstraints.deviceId = { exact: target.deviceId };

          console.log("videoConstraints", videoConstraints);

          const constraints = {
            video: videoConstraints,
            audio: false,
          };
          navigator.mediaDevices
            .getUserMedia(constraints)
            .then((stream) => {
              const newVideoTrack = stream.getVideoTracks()[0];
              const senders = self.activeCall.peerConn.getSenders();
              const videoSender = senders.find((s) => {
                return s.track && s.track.kind === "video";
              });

              if (videoSender) {
                const oldTrack = videoSender.track;

                videoSender.replaceTrack(newVideoTrack);

                const localVideo = document.getElementById("local");
                if (localVideo) {
                  localVideo.srcObject = stream;
                }

                if (oldTrack) {
                  oldTrack.stop();
                }
              }
            })
            .catch(function (error) {
              console.error("Error switching camera:", error);
            });
        })
        .catch(function (error) {
          console.error("Error getting camera devices:", error);
        });
    } catch (e) {
      console.error("Error in camera method:", e);
    }
  }

  async switchCamera(deviceId) {
    try {
      if (!this.activeCall) return false;

      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = newStream.getVideoTracks()[0];

      const senders = this.activeCall.peerConn.getSenders();
      const videoSender = senders.find(
        (sender) => sender.track && sender.track.kind === "video",
      );

      if (videoSender) {
        const oldTrack = videoSender.track;
        await videoSender.replaceTrack(newVideoTrack);

        const localVideo = document.getElementById("local");
        if (localVideo) {
          localVideo.srcObject = newStream;
        }

        if (oldTrack) {
          oldTrack.stop();
        }

        return true;
      }

      return false;
    } catch (error) {
      console.error("Error switching camera:", error);
      return false;
    }
  }

  format() {
    console.log("format", this.root);
    if (this.root.classList.contains("middle")) {
      this.root.classList.remove("middle");
      this.toFull();
    } else if (this.root.classList.contains("full")) {
      this.root.classList.remove("full");
      this.toMiddle();
    }
  }
  pip(e) {
    console.log("E", e);
    if (this.root.classList.contains("middle")) {
      this.root.classList.remove("middle");
      this.toMini();
    } else if (this.root.classList.contains("full")) {
      this.root.classList.remove("full");
      this.toMini();
    } else {
      this.cancelMini();
      this.toMiddle();
    }
  }
  toMiddle() {
    debugger;
    this.root.classList.add("middle");
    localStorage.setItem("callSizeSettings", "middle");

    this.view = "middle";

    if (this?.options?.changeView) {
      this.options.changeView(this.activeCall, this);
    }
  }
  toFull() {
    this.root.classList.add("full");
    localStorage.setItem("callSizeSettings", "full");

    this.view = "full";

    if (this?.options?.changeView) {
      this.options.changeView(this.activeCall, this);
    }
  }

  getRootTranslate() {
    var tr = (
      (this.root.style.transform || "")
        .replace("translate3d(", "")
        .replace(")", "")
        .replace(/px/g, "") || "0,0,0"
    ).split(",");

    return {
      x: Number(tr[0]),
      y: Number(tr[1]),
    };
  }

  setRootTranslate({ x, y }) {
    window.requestAnimationFrame(() => {
      this.root.style.transform =
        "translate3d(" + (x || 0) + "px," + (y || 0) + "px,0px)";
    });
  }

  toMini() {
    this.root.classList.add("minified");
    localStorage.setItem("callSizeSettings", "mini");

    this.view = "mini";

    if (this?.options?.changeView) {
      this.options.changeView(this.activeCall, this);
    }

    /*if(typeof Hammer != 'undefined'){
			console.log("HAMMER")
			this.hammertime = new Hammer(this.root);

			this.hammertime.get('pan').set({ threshold: 20, direction: Hammer.DIRECTION_ALL });


			var x = 0, y = 0, started = false

			this.hammertime.on('pan', (e) => {

				console.log("E", e, e.isFirst)

				if (e.isFirst){

					var rt = this.getRootTranslate()

					x = rt.x;
					y = rt.y

					started = true
				}

				if (started){
					var nx = x + e.deltaX
					var ny = y + e.deltaY
					this.setRootTranslate({x : nx, y : ny})
				}

				if (e.isFinal){
					started = false
				}


			});
		}

		return*/

    let pos = JSON.parse(localStorage.getItem("callPositionSettings"));

    console.log("pospos", pos);

    if (pos && pos.top && pos.left) {
      this.root.style.bottom = "auto";
      this.root.style.top = pos.top;
      this.root.style.left = pos.left;
    }

    this.root.onmousedown = (event) => {
      console.log("mouse down");

      event.preventDefault();
      if (event.target.classList.contains("bc-btn")) return;

      if (event.target.closest(".bc-video.minified")) return;
      let shiftLeft = event.clientX - this.root.getBoundingClientRect().left;
      let shiftTop = event.clientY - this.root.getBoundingClientRect().top;
      this.root.style.cursor = "grabbing";
      this.root.style.zIndex = 10000000;
      document.onmousemove = (e) => {
        this.root.style.bottom = "auto";
        if (e.pageY) {
          if (
            window.innerHeight - this.root.getBoundingClientRect().bottom >
              10 &&
            e.clientY - shiftTop > 10
          ) {
            if (
              window.innerHeight - this.root.offsetHeight - 11 >=
              e.clientY - shiftTop
            ) {
              this.root.style.top = this.getPercents(
                "height",
                e.clientY - shiftTop,
              );
            }
          } else if (
            window.innerHeight - this.root.getBoundingClientRect().bottom <=
              10 &&
            e.movementY < 0
          ) {
            this.root.style.top = this.getPercents(
              "height",
              window.innerHeight - this.root.offsetHeight - 11,
            );
          } else {
            console.log(
              "y out",
              window.innerHeight - this.root.getBoundingClientRect().bottom,
              e.clientY - shiftTop,
            );
          }
        } else {
          return;
        }
        if (e.pageX) {
          if (
            0 < e.clientX - shiftLeft &&
            e.clientX - shiftLeft < 10 &&
            e.movementX > 0
          ) {
            this.root.style.left = e.pageX - shiftLeft + "px";
          } else if (
            e.clientX - shiftLeft > 10 &&
            document.body.clientWidth -
              this.root.getBoundingClientRect().left -
              this.root.offsetWidth >
              70
          ) {
            if (
              document.body.clientWidth - this.root.offsetWidth - 71 >=
              e.pageX - shiftLeft
            ) {
              this.root.style.left = this.getPercents(
                "width",
                e.pageX - shiftLeft,
              );
            }
          } else if (
            document.body.clientWidth -
              this.root.getBoundingClientRect().left -
              this.root.offsetWidth <=
              70 &&
            e.movementX < 0
          ) {
            this.root.style.left = this.root.style.left = this.getPercents(
              "width",
              document.body.clientWidth - this.root.offsetWidth - 71,
            );
          } else {
            console.log(
              "x out",
              document.body.clientWidth -
                this.root.getBoundingClientRect().left -
                this.root.offsetWidth,
            );
          }
        } else {
          return;
        }
      };

      document.onmouseleave = (event) => {
        event.preventDefault();
        console.log("leave");
        document.onmousemove = null;
        this.root.onmouseup = null;
        this.root.ontouchend = null;
      };

      document.onmouseup = (event) => {
        console.log("mouse up");
        localStorage.setItem(
          "callPositionSettings",
          JSON.stringify({
            left: this.root.style.left,
            top: this.root.style.top,
          }),
        );
        document.onmousemove = null;
        this.root.style.cursor = "grab";
        document.onmouseup = null;
      };
      document.ontouchend = (event) => {
        localStorage.setItem(
          "callPositionSettings",
          JSON.stringify({
            left: this.root.style.left,
            top: this.root.style.top,
          }),
        );
        if (!event.target.classList.contains("bc-btn")) {
          event.preventDefault();
        }
        document.onmousemove = null;
        this.root.style.cursor = "grab";
        document.ontouchend = null;
      };
      event.stopPropagation();
    };
    this.root.ondragstart = function () {
      return false;
    };
  }

  getPercents(type, value) {
    let res;
    switch (type) {
      case "width":
        res = parseInt(value, 10) / window.innerWidth;
        break;
      case "height":
        res = parseInt(value, 10) / window.innerHeight;
        break;
    }
    return `${res * 100 + "%"}`;
  }

  cancelMini() {
    this.root.classList.remove("minified");

    if (this.hammertime) {
      this.hammertime.off("pan");
      this.hammertime.destroy();
    }

    document.onmousemove = null;
    this.root.style = {};
    this.root.onmousedown = null;

    if (this?.options?.onCancelMini) {
      this.options.onCancelMini(this.activeCall, this);
    }
  }

  /**
   * @param {string} roomId
   * @param {keyof CallTypes} [callType="video"]
   * @returns {Promise<MatrixCall>}
   */
  initCall(roomId, callType = CallTypes.video) {
    const _isVideoCall = isVideoCall(callType);

    if (this?.activeCall?.roomId === roomId) {
      console.log("only one call in room", this?.activeCall?.state);
      if (this?.activeCall?.state === "ringing") {
        console.log("answer to incoming from same room");
        this.answer(callType);
      }
      return Promise.reject();
    }

    console.log("init call");

    return this.initCordovaPermisions(callType).then(() => {
      let members = this.client.store.rooms[roomId].currentState.members;

      let initiatorId = Object.keys(members).filter(
        (m) => m !== this.client.credentials.userId,
      );

      let initiator = members[initiatorId];

      let user = members[this.client.credentials.userId];

      return this.options
        .getUserInfo(initiator.userId)
        .then((res) => {
          initiator.source = res[0] || res;

          console.log(res, initiator);

          this.emit("initcall");

          const call = this.matrixcs.createNewMatrixCall(this.client, roomId);

          // console.log('after init',this.activeCall)
          if (!this.activeCall) {
            this.activeCall = call;
          } else {
            // console.log('You have active call',this.activeCall)
            return;
          }

          let a = new Audio("js/lib");
          a.autoplay = true;
          a.loop = true;
          a.volume = 0.5;
          this.signal = a;

          console.log("init call2");

          return call.placeCall(true, _isVideoCall).then(() => {
            console.log("init call3");

            call.initiator = initiator;
            call.user = user;

            this.addCallListeners(call);

            this.signal.src = "sounds/calling.mp3";
            this.renderTemplates.call(callType);

            return call;
          });
        })
        .catch((e) => {
          console.log("get user info error", e);
          return Promise.reject(e);
        });
    });
  }

  hexDecode(hex) {
    var ch = 0;
    var result = "";
    for (var i = 2; i <= hex.length; i += 2) {
      ch = parseInt(hex.substring(i - 2, i), 16);
      if (ch >= 128) ch += 0x350;
      ch = String.fromCharCode("0x" + ch?.toString(16));
      result += ch;
    }
    return result;
  }

  hangup(e) {
    e.stopPropagation();

    this.activeCall.hangup("ended", false);
    this.stopAllMediaTracks();
    this.renderTemplates.clearVideo();

    this.signal.pause();
  }

  reject(call) {
    call.reject("busy");
    this.signal.pause();
  }
  setLocalElement() {
    const st = this.activeCall.feeds.find(
      (f) => f.userId === this.activeCall.user.userId,
    )?.stream;
    try {
      st && document.getElementById("local")
        ? document.getElementById("local").srcObject
          ? null
          : (document.getElementById("local").srcObject = st)
        : null;
    } catch (e) {
      console.log(e);
    }
  }
  setRemoteElement() {
    const st = this.activeCall.feeds.find(
      (f) => f.userId !== this.activeCall.user.userId,
    )?.stream;
    try {
      if (st && document.getElementById("remote")) {
        document.getElementById("remote").srcObject = st;

        const preferredDevice = localStorage.getItem("preferredAudioOutput");
        if (
          preferredDevice &&
          preferredDevice !== "default" &&
          document.getElementById("remote").setSinkId
        ) {
          document
            .getElementById("remote")
            .setSinkId(preferredDevice)
            .catch(console.error);
        }

        this.updateAudioButtonState(preferredDevice || "default");
      }
    } catch (e) {
      console.log(e);
    }
  }

  initCallInterface(type, call) {
    switch (type) {
      case "incomingCall":
        document
          .getElementById("bc-answer-voice")
          .addEventListener("click", () => this.answer(CallTypes.voice));
        document
          .getElementById("bc-answer-video")
          ?.addEventListener("click", () => this.answer(CallTypes.video));
        document
          .getElementById("bc-decline")
          .addEventListener("click", () => this.reject(call));
        break;
      case "videoCall":
        this.videoStreams = {
          remote: document.getElementById("remote"),
          local: document.getElementById("local"),
        };
        try {
          console.log("init call interface", this.activeCall);
          this.cameraCount();
          this.root.style = {};
          let size = localStorage.getItem("callSizeSettings")?.toString();
          this.setLocalElement();
          console.log("init with " + size);
          switch (size) {
            case "mini":
              this.toMini();
              break;
            case "middle":
              this.toMiddle();
              break;
            case "full":
              this.toFull();
              break;
            default:
              this.toMiddle();
              break;
          }

          this.addVideoInterfaceListeners();
        } catch (e) {
          console.log("init interface error", e);
        }
        break;
    }
  }

  addVideoInterfaceListeners() {
    document
      .getElementById("bc-decline")
      ?.addEventListener("click", (e) => this.hangup.call(this, e));
    document
      .getElementById("bc-mute")
      ?.addEventListener("click", (e) => this.mute.call(this, e));
    document
      .getElementById("bc-video-on")
      ?.addEventListener("click", (e) => this.updateCall(CallTypes.voice));
    document
      .getElementById("bc-video-off")
      ?.addEventListener("click", (e) => this.updateCall(CallTypes.video));
    document
      .getElementById("bc-camera")
      ?.addEventListener("click", (e) => this.camera.call(this, e));
    document
      .getElementById("bc-screen-share")
      ?.addEventListener("click", (e) => this.toggleScreenShare.call(this, e));
    document
      .getElementById("bc-audio-selector")
      ?.addEventListener("click", (e) => this.showAudioDevices.call(this, e));
    document
      .getElementById("bc-expand")
      ?.addEventListener("click", (e) => this.pip.call(this, e));
    document
      .getElementById("remote-scene")
      ?.addEventListener("click", (e) => this.pip.call(this, e));
    document
      .getElementById("bc-pip")
      ?.addEventListener("click", (e) => this.pip.call(this, e));
    document
      .getElementById("bc-format")
      ?.addEventListener("click", (e) => this.format.call(this, e));

    this.initResizeHandlers();
  }

  initResizeHandlers() {
    setTimeout(() => {
      const minifiedVideos = document.querySelectorAll(".bc-video.minified");
      minifiedVideos.forEach((videoElement) => {
        this.makeVideoResizable(videoElement);
      });
    }, 100);
  }

  makeVideoResizable(element) {
    const resizeHandles = element.querySelectorAll(".resize-handle");
    if (!resizeHandles.length) return;

    let isResizing = false;
    let isDragging = false;
    const aspectRatio = 4 / 3;

    const getContainerBounds = () => {
      const containers = [
        document.querySelector("#bc-container"),
        document.querySelector("#bc-root"),
        this.container,
        this.root,
      ].filter(Boolean);

      for (const container of containers) {
        if (container) {
          const rect = container.getBoundingClientRect();

          if (rect.width > 0 && rect.height > 0) {
            const padding = 15;
            const bounds = {
              left: rect.left + padding,
              top: rect.top + padding,
              right: rect.right - padding,
              bottom: rect.bottom - padding,
              width: rect.width - padding * 2,
              height: rect.height - padding * 2,
            };

            return bounds;
          }
        }
      }

      const padding = 15;
      const bounds = {
        left: padding,
        top: padding,
        right: window.innerWidth - padding,
        bottom: window.innerHeight - padding,
        width: window.innerWidth - padding * 2,
        height: window.innerHeight - padding * 2,
      };

      return bounds;
    };

    const adjustElementPosition = () => {
      const bounds = getContainerBounds();
      const rect = element.getBoundingClientRect();

      let currentLeft = parseInt(element.style.left);
      let currentTop = parseInt(element.style.top);

      if (isNaN(currentLeft) || isNaN(currentTop)) {
        currentLeft = rect.left;
        currentTop = rect.top;
      }

      let newLeft = currentLeft;
      let newTop = currentTop;

      const elementWidth = rect.width;
      const elementHeight = rect.height;

      if (currentLeft < bounds.left) {
        newLeft = bounds.left;
      }
      if (currentTop < bounds.top) {
        newTop = bounds.top;
      }
      if (currentLeft + elementWidth > bounds.right) {
        newLeft = Math.max(bounds.left, bounds.right - elementWidth);
      }
      if (currentTop + elementHeight > bounds.bottom) {
        newTop = Math.max(bounds.top, bounds.bottom - elementHeight);
        console.log(
          "Correcting bottom overflow: was",
          currentTop,
          "now",
          newTop,
        );
      }

      if (newLeft !== currentLeft || newTop !== currentTop) {
        console.log("Applying new position:", { newLeft, newTop });
        element.style.left = newLeft + "px";
        element.style.top = newTop + "px";
        element.style.right = "auto";
        element.style.bottom = "auto";
        element.style.position = "fixed";
      }
    };

    resizeHandles.forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();

        isResizing = true;
        element.classList.add("no-transition");

        const startX = e.clientX;
        const startY = e.clientY;

        const rect = element.getBoundingClientRect();
        const startWidth = rect.width;
        const startHeight = rect.height;

        let startLeft = parseInt(element.style.left);
        let startTop = parseInt(element.style.top);

        if (isNaN(startLeft) || isNaN(startTop)) {
          startLeft = rect.left;
          startTop = rect.top;
          element.style.left = startLeft + "px";
          element.style.top = startTop + "px";
          element.style.right = "auto";
          element.style.bottom = "auto";
        }

        const handleType = handle.classList.contains("nw")
          ? "nw"
          : handle.classList.contains("ne")
            ? "ne"
            : handle.classList.contains("sw")
              ? "sw"
              : "se";

        const onMouseMove = (e) => {
          if (!isResizing) return;

          let deltaX = e.clientX - startX;
          let deltaY = e.clientY - startY;
          let newWidth, newHeight, newLeft, newTop;

          let sizeChange = 0;
          switch (handleType) {
            case "se":
              sizeChange = deltaX;
              break;
            case "sw":
              sizeChange = -deltaX;
              break;
            case "ne":
              sizeChange = deltaX;
              break;
            case "nw":
              sizeChange = -deltaX;
              break;
          }

          newWidth = startWidth + sizeChange;
          newHeight = newWidth / aspectRatio;

          newWidth = Math.max(120, Math.min(400, newWidth));
          newHeight = newWidth / aspectRatio;

          switch (handleType) {
            case "se":
              newLeft = startLeft;
              newTop = startTop;
              break;
            case "sw":
              newLeft = startLeft - (newWidth - startWidth);
              newTop = startTop;
              break;
            case "ne":
              newLeft = startLeft;
              newTop = startTop - (newHeight - startHeight);
              break;
            case "nw":
              newLeft = startLeft - (newWidth - startWidth);
              newTop = startTop - (newHeight - startHeight);
              break;
          }

          const bounds = getContainerBounds();

          if (newLeft < bounds.left) {
            newLeft = bounds.left;
          }
          if (newTop < bounds.top) {
            newTop = bounds.top;
          }
          if (newLeft + newWidth > bounds.right) {
            const maxWidth = bounds.right - newLeft;
            newWidth = Math.min(newWidth, maxWidth);
            newHeight = newWidth / aspectRatio;
          }
          if (newTop + newHeight > bounds.bottom) {
            const maxHeight = bounds.bottom - newTop;
            newHeight = Math.min(newHeight, maxHeight);
            newWidth = newHeight * aspectRatio;
          }

          element.style.width = newWidth + "px";
          element.style.height = newHeight + "px";
          element.style.left = newLeft + "px";
          element.style.top = newTop + "px";
          element.style.right = "auto";
          element.style.bottom = "auto";
        };

        const onMouseUp = () => {
          isResizing = false;
          element.classList.remove("no-transition");
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    });

    element.style.pointerEvents = "auto";

    element.addEventListener("mousedown", (e) => {
      if (
        e.target.classList.contains("resize-handle") ||
        e.target.classList.contains("bc-btn")
      )
        return;

      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      element.classList.add("no-transition");

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;

      let startElementX = parseInt(element.style.left);
      let startElementY = parseInt(element.style.top);

      if (isNaN(startElementX) || isNaN(startElementY)) {
        const rect = element.getBoundingClientRect();
        startElementX = rect.left;
        startElementY = rect.top;
        element.style.left = startElementX + "px";
        element.style.top = startElementY + "px";
        element.style.right = "auto";
        element.style.bottom = "auto";
      }

      element.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      const onMouseMove = (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - startMouseX;
        const deltaY = e.clientY - startMouseY;

        let newLeft = startElementX + deltaX;
        let newTop = startElementY + deltaY;

        const bounds = getContainerBounds();
        const rect = element.getBoundingClientRect();

        const maxLeft = bounds.right - rect.width;
        const maxTop = bounds.bottom - rect.height;
        const minLeft = bounds.left;
        const minTop = bounds.top;

        newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
        newTop = Math.max(minTop, Math.min(maxTop, newTop));

        element.style.left = newLeft + "px";
        element.style.top = newTop + "px";
        element.style.right = "auto";
        element.style.bottom = "auto";
      };

      const onMouseUp = () => {
        isDragging = false;
        element.classList.remove("no-transition");
        element.style.cursor = "grab";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    element.style.opacity = "0";
    element.style.pointerEvents = "none";

    const initializeVideoPosition = () => {
      setTimeout(() => {
        const bounds = getContainerBounds();

        let videoWidth, videoHeight, leftX, topY;

        {
          videoWidth = 160;
          videoHeight = 120;
          const padding = 20;

          leftX = bounds.left + bounds.width - videoWidth - padding;
          topY = bounds.top + bounds.height - videoHeight - padding;
        }

        element.style.position = "fixed";
        element.style.left = leftX + "px";
        element.style.top = topY + "px";
        element.style.width = videoWidth + "px";
        element.style.height = videoHeight + "px";
        element.style.right = "auto";
        element.style.bottom = "auto";

        element.style.opacity = "1";
        element.style.pointerEvents = "auto";

        videoInitialized = true;
      }, 600);
    };

    initializeVideoPosition();

    const transitionEndHandler = (e) => {
      if (
        e.propertyName === "width" ||
        e.propertyName === "height" ||
        e.propertyName === "transform"
      ) {
        if (videoInitialized) {
          element.style.opacity = "0";
        }

        setTimeout(() => {
          const bounds = getContainerBounds();
          const rect = element.getBoundingClientRect();

          const needsAdjustment =
            rect.left < bounds.left ||
            rect.top < bounds.top ||
            rect.right > bounds.right ||
            rect.bottom > bounds.bottom;

          if (needsAdjustment) {
            adjustElementPosition();
          }

          if (videoInitialized) {
            setTimeout(() => {
              element.style.opacity = "1";
            }, 30);
          }
        }, 50);
      }
    };

    element.addEventListener("transitionend", transitionEndHandler);

    let videoInitialized = false;

    const resizeObserver = new ResizeObserver(() => {
      if (videoInitialized) {
        element.style.opacity = "0";
      }

      setTimeout(() => {
        const bounds = getContainerBounds();
        const rect = element.getBoundingClientRect();

        const needsAdjustment =
          rect.left < bounds.left ||
          rect.top < bounds.top ||
          rect.right > bounds.right ||
          rect.bottom > bounds.bottom;

        if (needsAdjustment) {
          adjustElementPosition();
        }

        if (videoInitialized) {
          setTimeout(() => {
            element.style.opacity = "1";
          }, 50);
        }
      }, 400);
    });

    const containers = [
      document.querySelector("#bc-container"),
      document.querySelector("#bc-root"),
      this.container,
      this.root,
    ].filter(Boolean);

    containers.forEach((container) => {
      if (container) {
        resizeObserver.observe(container);
      }
    });

    const windowResizeHandler = () => {
      if (videoInitialized) {
        element.style.opacity = "0";
      }

      setTimeout(() => {
        const bounds = getContainerBounds();
        const rect = element.getBoundingClientRect();

        const needsAdjustment =
          rect.left < bounds.left ||
          rect.top < bounds.top ||
          rect.right > bounds.right ||
          rect.bottom > bounds.bottom;

        if (needsAdjustment) {
          console.log("Window resized, element outside bounds, adjusting...");
          adjustElementPosition();
        }

        if (videoInitialized) {
          setTimeout(() => {
            element.style.opacity = "1";
          }, 50);
        }
      }, 400);
    };

    window.addEventListener("resize", windowResizeHandler);

    element._resizeObserver = resizeObserver;
    element._windowResizeHandler = windowResizeHandler;

    element._cleanupResizeHandlers = () => {
      if (element._resizeObserver) {
        element._resizeObserver.disconnect();
        element._resizeObserver = null;
      }
      if (element._windowResizeHandler) {
        window.removeEventListener("resize", element._windowResizeHandler);
        element._windowResizeHandler = null;
      }
      if (transitionEndHandler) {
        element.removeEventListener("transitionend", transitionEndHandler);
      }
    };

    this.updateVideoBorder(element);
  }

  updateVideoBorder(element) {
    const video = element.querySelector("video");
    if (video && !video.classList.contains("hidden")) {
      element.classList.add("video-on");
    } else {
      element.classList.remove("video-on");
    }
  }

  async showAudioDevices(e) {
    e.stopPropagation();

    const existingDropdown = document.querySelector(".bc-audio-dropdown");
    if (existingDropdown) {
      existingDropdown.remove();
      return;
    }

    const devices = await this.getAudioDevices();
    const currentOutput =
      localStorage.getItem("preferredAudioOutput") || "default";
    const currentInput =
      localStorage.getItem("preferredMicrophoneInput") || "default";

    const dropdown = document.createElement("div");
    dropdown.className = "bc-audio-dropdown";

    const speakerHeader = document.createElement("div");
    speakerHeader.className = "bc-audio-dropdown-header";
    speakerHeader.innerHTML =
      '<i class="fas fa-volume-up"></i> Speakers / Headphones';
    dropdown.appendChild(speakerHeader);

    const defaultSpeaker = document.createElement("div");
    defaultSpeaker.className = `bc-audio-dropdown-item ${currentOutput === "default" ? "selected" : ""}`;
    defaultSpeaker.innerHTML = `
          <i class="fas fa-volume-up"></i>
          <span>Default Speaker</span>
      `;
    defaultSpeaker.addEventListener("click", async () => {
      const success = await this.setAudioOutput("");
      if (success) {
        this.updateDropdownSelection(dropdown, defaultSpeaker, "speaker");
        dropdown.remove();
      }
    });
    dropdown.appendChild(defaultSpeaker);

    devices.speakers.forEach((device, index) => {
      const item = document.createElement("div");
      item.className = `bc-audio-dropdown-item ${device.deviceId === currentOutput ? "selected" : ""}`;

      let icon = "fas fa-volume-up";
      const label = device.label.toLowerCase();
      if (label.includes("headphone") || label.includes("headset")) {
        icon = "fas fa-headphones";
      } else if (
        label.includes("bluetooth") ||
        label.includes("airpod") ||
        label.includes("wh-")
      ) {
        icon = "fab fa-bluetooth-b";
      }

      const deviceName = device.label || `Speaker ${index + 1}`;
      item.innerHTML = `
              <i class="${icon}"></i>
              <span title="${deviceName}">${deviceName}</span>
          `;

      item.addEventListener("click", async () => {
        console.log("Setting audio output to:", device.deviceId);
        const success = await this.setAudioOutput(device.deviceId);
        if (success) {
          this.updateDropdownSelection(dropdown, item, "speaker");
          dropdown.remove();
        }
      });

      dropdown.appendChild(item);
    });

    const separator = document.createElement("div");
    separator.className = "bc-audio-dropdown-separator";
    dropdown.appendChild(separator);

    const micHeader = document.createElement("div");
    micHeader.className = "bc-audio-dropdown-header";
    micHeader.innerHTML = '<i class="fas fa-microphone"></i> Microphones';
    dropdown.appendChild(micHeader);

    // Default microphone
    const defaultMic = document.createElement("div");
    defaultMic.className = `bc-audio-dropdown-item ${currentInput === "default" ? "selected" : ""}`;
    defaultMic.innerHTML = `
          <i class="fas fa-microphone"></i>
          <span>Default Microphone</span>
      `;
    defaultMic.addEventListener("click", async () => {
      const success = await this.setMicrophoneInput("");
      if (success) {
        this.updateDropdownSelection(dropdown, defaultMic, "microphone");
        dropdown.remove();
      }
    });
    dropdown.appendChild(defaultMic);

    // Microphones
    devices.microphones.forEach((device, index) => {
      const item = document.createElement("div");
      item.className = `bc-audio-dropdown-item ${device.deviceId === currentInput ? "selected" : ""}`;

      let icon = "fas fa-microphone";
      const label = device.label.toLowerCase();
      if (
        label.includes("bluetooth") ||
        label.includes("airpod") ||
        label.includes("wh-")
      ) {
        icon = "fab fa-bluetooth-b";
      } else if (label.includes("headset") || label.includes("headphone")) {
        icon = "fas fa-headset";
      }

      const deviceName = device.label || `Microphone ${index + 1}`;
      item.innerHTML = `
              <i class="${icon}"></i>
              <span title="${deviceName}">${deviceName}</span>
          `;

      item.addEventListener("click", async () => {
        const success = await this.setMicrophoneInput(device.deviceId);
        if (success) {
          this.updateDropdownSelection(dropdown, item, "microphone");
          dropdown.remove();
        }
      });

      dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);

    setTimeout(() => (dropdown.style.opacity = "1"), 10);

    const closeDropdown = (event) => {
      if (
        !dropdown.contains(event.target) &&
        !event.target.closest("#bc-audio-output")
      ) {
        dropdown.style.opacity = "0";
        setTimeout(() => {
          if (dropdown.parentNode) dropdown.remove();
        }, 200);
        document.removeEventListener("click", closeDropdown);
      }
    };

    setTimeout(() => {
      document.addEventListener("click", closeDropdown);
    }, 100);

    setTimeout(() => {
      if (dropdown.parentNode) {
        dropdown.style.opacity = "0";
        setTimeout(() => dropdown.remove(), 200);
      }
    }, 20000);
  }

  updateDropdownSelection(dropdown, selectedItem, type) {
    const headers = dropdown.querySelectorAll(".bc-audio-dropdown-header");
    let startHeader = null;
    let endHeader = null;

    if (type === "speaker") {
      startHeader = Array.from(headers).find((h) =>
        h.innerHTML.includes("Speakers"),
      );
      endHeader = Array.from(headers).find((h) =>
        h.innerHTML.includes("Microphones"),
      );
    } else {
      startHeader = Array.from(headers).find((h) =>
        h.innerHTML.includes("Microphones"),
      );
    }

    let current = startHeader?.nextElementSibling;
    while (current && current !== endHeader) {
      if (current.classList.contains("bc-audio-dropdown-item")) {
        current.classList.remove("selected");
      }
      current = current.nextElementSibling;
    }

    selectedItem.classList.add("selected");
  }
  updateAudioButtonState(deviceId) {
    const button = document.getElementById("bc-audio-output");
    if (!button) return;

    const devices = this.getAudioDevices();
    devices.then((result) => {
      const selectedDevice = result.speakers.find(
        (d) => d.deviceId === deviceId,
      );
      let icon = "fas fa-volume-up";

      if (selectedDevice) {
        const label = selectedDevice.label.toLowerCase();
        if (label.includes("headphone") || label.includes("headset")) {
          icon = "fas fa-headphones";
        } else if (label.includes("bluetooth") || label.includes("airpod")) {
          icon = "fab fa-bluetooth-b";
        }
      }

      button.innerHTML = `<i class="${icon}"></i>`;
      button.classList.add("active");
    });
  }

  updateCallElements() {
    this.setRemoteElement();
    this.setLocalElement();
  }

  addCallListeners(call) {
    console.log("addCallListeners");
    this.on("muteStateChanged", () => {
      console.log("changed idas df as");
    });
    call.on("feeds_changed", (a, b) => {
      console.log("feed", a);
      this.updateCallElements();
    });

    this.client.on("Room.timeline", ({ event }) => {
      const isCallNegotiationEvent =
        event.type === "m.call.negotiate" &&
        event.room_id === this?.activeCall?.roomId;
      const isAnswerType = event.content?.description?.type === "answer";

      if (isCallNegotiationEvent && isAnswerType) {
        this.initsync();
      }
    });
    call.on("state", (a, b) => {
      console.log("state", a, call);

      if (window?.cordova?.plugins?.CordovaCall && call.callKitUUID) {
        try {
          if (a === "connected") {
            window.cordova.plugins.CordovaCall.connectCall(
              () => console.log("CallKit connected"),
              (err) => console.error("CallKit connect error:", err),
            );
          } else if (a === "ended") {
            window.cordova.plugins.CordovaCall.endCall(
              () => console.log("CallKit ended"),
              (err) => console.error("CallKit end error:", err),
            );
            if (this.callKitCalls[call.callKitUUID]) {
              delete this.callKitCalls[call.callKitUUID];
            }
          }
        } catch (error) {
          console.error("CallKit state update error:", error);
        }
      }

      if (a == "wait_local_media") {
      }

      if (a === "connecting" || a === "invite_sent") {
        this.signal.pause();
        this.showConnecting();
      }

      if (a === "connected") {
        this.signal.pause();
        this.showRemoteVideo();

        if (!this.timeInterval) {
          this.initTimer();
        } else {
        }
        this.clearBlinking();
        this.initsync();

        this.setCallUpdateControlsLoading(false);
        if (this?.options?.onConnected) {
          this.options.onConnected(call, this);
        }
      }

      if (a === "ended") {
        this.clearTimer();
        clearInterval(this.syncInterval);
        this.syncInterval = null;
        this.signal.pause();
        this.clearBlinking();
        if (this?.options?.onEnded) {
          this.options.onEnded(call, this);
        }
      }
    });
    call.on("hangup", (call) => {
      console.log("hangup", call);
      //this.signal.loop = false
      //this.signal.src = 'sounds/hangup.mp3'
      //
      //
      if (this.isScreenSharing) {
        this.stopScreenShare();
      }
      this.stopAllMediaTracks();
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log("Call ended", call.callId);
      if (!call) {
        this.renderTemplates.clearNotify();

        return;
      }

      if (call.callId === this.secondCall?.callId) {
        this.secondCall = null;
        if (this?.activeCall?.state !== "ringing") {
          this.renderTemplates.clearNotify();
        }
        // console.log('second line ended', call.callId)
      }

      if (call.callId === this.activeCall?.callId) {
        // console.log('first line ended', this)

        if (this.isWaitingForConnect) {
          this.activeCall = this.secondCall;
          this.secondCall = null;
          // console.log('second line is active', this.activeCall.callId)
          return;
        }
        this.renderTemplates.clearVideo();
        this.renderTemplates.clearNotify();

        if (call.hangupParty === "local" || call.localVideoElement) {
          if (
            this.root.classList.contains("minified") ||
            !this.root.classList.length
          ) {
            this.renderTemplates.clearVideo();
            this.renderTemplates.clearInterface();
            this.activeCall = null;
            return;
          }
          this.renderTemplates.endedCall(call);
          if (
            call.hangupReason === "user_hangup" &&
            !call.remoteStream &&
            call.hangupParty !== "local"
          ) {
            // console.log('busy', this.signal)
            this.signal.loop = false;
            this.signal.src = "sounds/busy.mp3";
          }
          setTimeout(() => {
            this.renderTemplates.clearVideo();
            this.renderTemplates.clearInterface();
            this.activeCall = null;
            // console.log('time out',this.activeCall)
          }, 1000);
          return;
        }

        this.signal.pause();
        this.renderTemplates.clearInterface();
        this.activeCall = null;
      }
    });
    call.on("replaced", (call) => {
      console.log("replaced", call);
      console.log("old", this.activeCall);
      this.activeCall = null;
      this.signal.pause();
      let members = this.client.store.rooms[call.roomId].currentState.members;
      let initiatorId = Object.keys(members).filter(
        (m) => m !== this.client.credentials.userId,
      );
      let initiator = members[initiatorId];
      let user = members[this.client.credentials.userId];

      call.initiator = initiator;
      call.user = user;
      this.options.getUserInfo(initiator.userId).then((res) => {
        if (call.hangupParty || call.hangupReason) {
          return;
        }
        initiator.source = res[0] || res;
        this.addCallListeners(call);
        console.log("listen added", this, call);
        if (!this.activeCall) {
          this.activeCall = call;
          this.answer();
          console.log("now active", this.activeCall);
        } else if (!this.secondCall) {
          this.secondCall = call;
          console.log("now second", this.secondCall);
          // console.log('nwe call in queue', call)
        } else {
          console.log("all lines");
          call.hangup("busy");
          call.reject("busy");
          // console.log('all calls', this)
        }
        if (call.state === "wait_local_media") {
          console.log("wait media!");
          setTimeout(
            function () {
              this.answer();
            }.bind(this),
            1000,
          );
        } else {
          this.answer();
        }
      });
    });
    call.on("error", (err) => {
      console.error("some error", err, this);
      call.hangup("error");
      this.signal.pause();
      this.renderTemplates.clearVideo();
      this.emit("error", err);
    });
  }

  getAvatar(call) {
    if (call?.initiator?.source?.image) {
      return `<img src="${
        typeof replaceArchiveInImage != "undefined"
          ? replaceArchiveInImage(call.initiator.source.image)
          : call.initiator.source.image
      }"/>`;
    }
    if (this.activeCall.initiator?.source?.image) {
      return `<img src="${
        typeof replaceArchiveInImage != "undefined"
          ? replaceArchiveInImage(this.activeCall.initiator.source.image)
          : this.activeCall.initiator.source.image
      }"/>`;
    }
    return `<span>${this.activeCall.initiator.source.name[0].toUpperCase()}</span>`;
  }

  showRemoteVideo() {
    this.setRemoteElement();

    const screenShareButton = document.getElementById("bc-screen-share");
    if (screenShareButton) {
      screenShareButton.disabled = false;
    }
  }

  showConnecting() {
    document.getElementById("remote-scene").classList.add("connecting");
  }

  setBlinking() {
    this.options.changeTitle
      ? this.options.changeTitle(this.options.getWithLocale("incomingCall"))
      : "";
  }

  clearBlinking() {
    this.options.changeTitle ? this.options.changeTitle() : "";
  }

  initCallKitIntegration() {
    window.BastyonCallsInstance = this;
    this.callKitCalls = {};

    if (window.cordova?.plugins?.CordovaCall) {
      this.setupCallKit();
    }
  }

  isCallKitAvailable() {
    return !!(window.CallKitBridge && window.CallKitBridge.isAvailable());
  }

  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c == "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
  }

  showIncomingCall(call) {
    if (window.cordova?.plugins?.CordovaCall) {
      console.log("Using CallKit for incoming call");
      console.log(call, "call");
      const callUUID = this.generateUUID();
      call.callKitUUID = callUUID;
      if (!this.callKitCalls) {
        this.callKitCalls = {};
      }
      this.callKitCalls[callUUID] = call;

      const callerName = call.initiator?.source?.name || "Unknown";

      try {
        window.cordova.plugins.CordovaCall.receiveCall(
          callerName,
          callUUID,
          () => console.log("CallKit call displayed"),
          (err) => {
            console.error("CallKit receiveCall error:", err);
            this.showWebIncomingCall(call);
          },
        );
        return;
      } catch (error) {
        console.error("CallKit error:", error);
      }
    }

    console.log("Using web UI for incoming call");
    let a = new Audio("js/lib");
    a.autoplay = true;
    a.loop = true;
    a.volume = 0.5;
    this.signal = a;
    this.signal.src = "sounds/incoming.mp3";
    this.renderTemplates.incomingCall(call);
  }

  handleCallKitAnswer(data) {
    const call = this.callKitCalls[data.callUUID];
    if (call) {
      const callType = data.isVideo ? CallTypes.video : CallTypes.voice;
      this.answer(callType);
    }
  }

  handleCallKitReject(data) {
    const call = this.callKitCalls[data.callUUID];
    if (call) {
      this.reject(call);
      delete this.callKitCalls[data.callUUID];
    }
  }

  handleCallKitHangup(data) {
    const call = this.callKitCalls[data.callUUID];
    if (call) {
      call.hangup();
      delete this.callKitCalls[data.callUUID];
    }
  }

  async getElectronScreenStream() {
    try {
      console.log("Getting screen sources from Electron...");

      const sources = await window.electron.ipcRenderer.invoke(
        "get-desktop-sources",
      );

      if (!sources || sources.length === 0) {
        throw new Error("No screen sources available");
      }

      let selectedSource;
      if (sources.length > 1) {
        selectedSource = await this.showElectronSourceSelector(sources);
      } else {
        selectedSource = sources[0];
      }

      if (!selectedSource) {
        throw new Error("No screen source selected");
      }

      const screenStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSource.id,
          },
        },
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSource.id,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
          },
        },
      });

      return screenStream;
    } catch (error) {
      console.error("Error getting Electron screen stream:", error);
      throw error;
    }
  }

  async showElectronSourceSelector(sources) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "bc-electron-source-selector";

      const dialog = document.createElement("div");

      const title = document.createElement("h3");
      title.textContent = "Select Screen or Window to Share";
      dialog.appendChild(title);

      const sourceList = document.createElement("div");

      sources.forEach((source) => {
        const sourceItem = document.createElement("div");

        if (source.thumbnail) {
          const img = document.createElement("img");
          img.src = source.thumbnail;
          sourceItem.appendChild(img);
        }

        const label = document.createElement("div");
        label.textContent = source.name;
        sourceItem.appendChild(label);

        sourceItem.addEventListener("click", () => {
          modal.remove();
          resolve(source);
        });

        sourceList.appendChild(sourceItem);
      });

      dialog.appendChild(sourceList);

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        modal.remove();
        resolve(null);
      });
      dialog.appendChild(cancelBtn);

      modal.appendChild(dialog);
      document.body.appendChild(modal);
    });
  }

  async createCompositeStream(cameraStream, screenStream) {
    try {
      if (!screenStream || !screenStream.getVideoTracks().length) {
        console.error("Invalid screen stream");
        return null;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = 1280;
      canvas.height = 720;

      const screenVideo = document.createElement("video");
      screenVideo.srcObject = screenStream;
      screenVideo.muted = true;
      screenVideo.playsInline = true;

      const cameraVideo = document.createElement("video");
      let cameraReady = false;

      if (cameraStream && cameraStream.getVideoTracks().length > 0) {
        cameraVideo.srcObject = cameraStream;
        cameraVideo.muted = true;
        cameraVideo.playsInline = true;
      }

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Screen video timeout")),
          5000,
        );

        screenVideo.onloadeddata = () => {
          clearTimeout(timeout);
          resolve();
        };
        screenVideo.onerror = (e) => {
          clearTimeout(timeout);
          reject(e);
        };
        screenVideo.play().catch(reject);
      });

      if (cameraStream && cameraStream.getVideoTracks().length > 0) {
        try {
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              console.log("Camera timeout, continuing without");
              resolve();
            }, 3000);

            cameraVideo.onloadeddata = () => {
              clearTimeout(timeout);
              cameraReady = true;
              console.log("Camera video ready");
              resolve();
            };
            cameraVideo.onerror = () => {
              clearTimeout(timeout);
              console.log("Camera error, continuing without");
              resolve();
            };
            cameraVideo.play().catch(() => {
              clearTimeout(timeout);
              resolve();
            });
          });
        } catch (error) {
          console.log("Camera setup failed:", error);
        }
      }

      const drawFrame = () => {
        if (this.isCompositeActive) {
          try {
            ctx.fillStyle = "transparent";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (screenVideo.readyState >= 2) {
              ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
            }

            if (cameraReady && cameraVideo.readyState >= 2) {
              const pipWidth = 160;
              const pipHeight = 120;
              const pipX = canvas.width - pipWidth - 15;
              const pipY = 15;

              ctx.fillRect(pipX - 3, pipY - 3, pipWidth + 6, pipHeight + 6);

              ctx.lineWidth = 3;
              ctx.strokeRect(pipX, pipY, pipWidth, pipHeight);

              ctx.drawImage(cameraVideo, pipX, pipY, pipWidth, pipHeight);
            }

            requestAnimationFrame(drawFrame);
          } catch (error) {
            console.error("Draw frame error:", error);
            if (this.isCompositeActive) {
              requestAnimationFrame(drawFrame);
            }
          }
        }
      };

      this.isCompositeActive = true;
      drawFrame();

      const compositeStream = canvas.captureStream(30);

      const screenAudioTracks = screenStream.getAudioTracks();
      screenAudioTracks.forEach((track) => {
        compositeStream.addTrack(track);
      });

      this.compositeCanvas = canvas;
      this.screenVideoElement = screenVideo;
      this.cameraVideoElement = cameraVideo;

      return compositeStream;
    } catch (error) {
      console.error("Error creating composite stream:", error);
      this.isCompositeActive = false;
      return null;
    }
  }

  async startScreenShare() {
    try {
      if (
        !this.activeCall ||
        !this.activeCall.peerConn ||
        this.activeCall.state !== "connected"
      ) {
        this.showAudioError("No active call to share screen");
        return false;
      }

      let screenStream;

      if (window.electron && window.electron.ipcRenderer) {
        screenStream = await this.getElectronScreenStream();
      } else {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: "always",
            displaySurface: "monitor",
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }

      screenStream.getVideoTracks()[0].addEventListener("ended", () => {
        console.log("Screen share ended by user");
        this.stopScreenShare();
      });

      const senders = this.activeCall.peerConn.getSenders();
      let videoSender = senders.find(
        (sender) => sender.track && sender.track.kind === "video",
      );

      const controls = document.getElementById("controls");
      const isVoiceCall = controls && controls.dataset.callType === "voice";
      const hasActiveVideo =
        videoSender && videoSender.track && videoSender.track.enabled;

      console.log(
        "Call type:",
        isVoiceCall ? "voice" : "video",
        "Has active video:",
        hasActiveVideo,
      );

      let finalStream;

      if (hasActiveVideo) {
        console.log("5a. Creating composite stream (video + screen)...");

        let cameraStream = null;
        try {
          const localVideo = document.getElementById("local");
          if (localVideo && localVideo.srcObject) {
            cameraStream = localVideo.srcObject;
          } else if (videoSender.track) {
            cameraStream = new MediaStream([videoSender.track]);
          }
        } catch (error) {
          console.log("Failed to get camera stream:", error);
        }

        if (cameraStream) {
          finalStream = await this.createCompositeStream(
            cameraStream,
            screenStream,
          );
        }

        if (!finalStream) {
          console.log("Composite failed, using screen only");
          finalStream = screenStream;
        }
      } else {
        console.log("5b. No active video, setting up screen-only sharing...");

        if (!videoSender) {
          videoSender = senders.find((sender) => !sender.track);

          if (!videoSender) {
            console.log("Creating new video sender...");
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "transparent";
            ctx.fillRect(0, 0, 1, 1);

            const tempStream = canvas.captureStream(1);
            const tempTrack = tempStream.getVideoTracks()[0];

            videoSender = this.activeCall.peerConn.addTrack(
              tempTrack,
              tempStream,
            );
            setTimeout(() => tempTrack.stop(), 100);
          }
        }

        finalStream = screenStream;
      }

      if (!finalStream) {
        throw new Error("Failed to create stream");
      }

      this.originalVideoTrack = videoSender.track;
      this.screenStream = screenStream;
      this.hadActiveVideoBeforeScreenShare = hasActiveVideo;

      const finalVideoTrack = finalStream.getVideoTracks()[0];
      await videoSender.replaceTrack(finalVideoTrack);

      const localVideo = document.getElementById("local");
      if (localVideo) {
        localVideo.srcObject = finalStream;
      }

      this.ensureVideoAreaVisible(isVoiceCall);

      this.isScreenSharing = true;
      this.updateScreenShareButton();

      console.log("Screen share started successfully");
      return true;
    } catch (error) {
      console.error("Error starting screen share:", error);

      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }

      if (error.name === "NotAllowedError") {
        this.showAudioError("Screen sharing permission denied");
      } else {
        this.showAudioError("Failed to start screen sharing");
      }

      return false;
    }
  }

  ensureRemoteVideoReady() {
    const remoteVideo = document.getElementById("remote");
    const remoteScene = document.getElementById("remote-scene");

    if (remoteScene) {
      remoteScene.classList.remove("novid");
      remoteScene.classList.remove("connecting");
    }

    if (remoteVideo) {
      remoteVideo.style.display = "block";

      if (!remoteVideo.srcObject) {
        remoteVideo.poster =
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      }
    }
  }

  async ensureVideoSender() {
    if (!this.activeCall?.peerConn) {
      throw new Error("No peer connection");
    }

    const senders = this.activeCall.peerConn.getSenders();
    let videoSender = senders.find((sender) => sender.track?.kind === "video");

    if (!videoSender) {
      console.log("Creating video sender...");

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "transparent";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const blackStream = canvas.captureStream(1);
      const blackTrack = blackStream.getVideoTracks()[0];

      videoSender = this.activeCall.peerConn.addTrack(blackTrack, blackStream);

      try {
        const offer = await this.activeCall.peerConn.createOffer();
        await this.activeCall.peerConn.setLocalDescription(offer);

        console.log("Renegotiation offer created");
      } catch (error) {
        console.error("Renegotiation failed:", error);
      }
    }

    return videoSender;
  }

  async stopScreenShare() {
    try {
      this.isCompositeActive = false;

      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }
      if (
        this.cameraStream &&
        this.cameraStream !== document.getElementById("local")?.srcObject
      ) {
        this.cameraStream.getTracks().forEach((track) => track.stop());
        this.cameraStream = null;
      }

      if (this.cameraVideoElement) {
        this.cameraVideoElement.remove();
        this.cameraVideoElement = null;
      }
      if (this.screenVideoElement) {
        this.screenVideoElement.remove();
        this.screenVideoElement = null;
      }
      if (this.compositeCanvas) {
        this.compositeCanvas.remove();
        this.compositeCanvas = null;
      }

      if (!this.activeCall?.peerConn) {
        this.restoreInterfaceAfterScreenShare();
        this.isScreenSharing = false;
        this.updateScreenShareButton();
        return true;
      }

      const senders = this.activeCall.peerConn.getSenders();
      const videoSender = senders.find(
        (sender) => sender.track && sender.track.kind === "video",
      );

      if (videoSender) {
        const oldTrack = videoSender.track;

        if (this.hadActiveVideoBeforeScreenShare) {
          console.log("Restoring camera...");

          if (
            this.originalVideoTrack &&
            this.originalVideoTrack.readyState === "live"
          ) {
            await videoSender.replaceTrack(this.originalVideoTrack);

            const localVideo = document.getElementById("local");
            if (localVideo) {
              const originalStream = new MediaStream([this.originalVideoTrack]);
              localVideo.srcObject = originalStream;
            }
          } else {
            try {
              const newCameraStream = await navigator.mediaDevices.getUserMedia(
                {
                  video: {
                    facingMode: "user",
                    width: { ideal: 640 },
                    height: { ideal: 360 },
                  },
                  audio: false,
                },
              );

              const newVideoTrack = newCameraStream.getVideoTracks()[0];
              await videoSender.replaceTrack(newVideoTrack);

              const localVideo = document.getElementById("local");
              if (localVideo) {
                localVideo.srcObject = newCameraStream;
              }
            } catch (error) {
              console.log("Failed to restore camera:", error);
              await videoSender.replaceTrack(null);
            }
          }
        } else {
          console.log("No video was active before, disabling video track...");
          await videoSender.replaceTrack(null);

          const localVideo = document.getElementById("local");
          if (localVideo) {
            localVideo.srcObject = null;
          }
        }

        if (oldTrack && oldTrack !== this.originalVideoTrack) {
          oldTrack.stop();
        }
      }

      this.restoreInterfaceAfterScreenShare();

      this.isScreenSharing = false;
      this.originalVideoTrack = null;
      this.hadActiveVideoBeforeScreenShare = false;
      this.updateScreenShareButton();

      console.log("Screen share stopped successfully");
      return true;
    } catch (error) {
      console.error("Error stopping screen share:", error);

      this.isScreenSharing = false;
      this.isCompositeActive = false;
      this.hadActiveVideoBeforeScreenShare = false;
      this.updateScreenShareButton();
      return false;
    }
  }

  restoreInterfaceAfterScreenShare() {
    const remoteScene = document.getElementById("remote-scene");
    const localVideo = document.getElementById("local");
    const controls = document.getElementById("controls");
    const isVoiceCall = controls && controls.dataset.callType === "voice";

    if (remoteScene) {
      remoteScene.classList.remove("screen-sharing");

      if (isVoiceCall && !this.hadActiveVideoBeforeScreenShare) {
        remoteScene.classList.add("novid");
      }
    }

    if (localVideo) {
      localVideo.classList.remove("screen-share-temp");

      if (isVoiceCall && !this.hadActiveVideoBeforeScreenShare) {
        localVideo.classList.add("hidden");
      }
    }

    console.log("Interface restored after screen sharing");
  }

  async startScreenOnlyShare() {
    console.log("Starting screen-only share...");

    try {
      if (!this.activeCall) {
        console.log("No active call");
        this.showAudioError("No active call to share screen");
        return false;
      }

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          displaySurface: "monitor",
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      screenStream.getVideoTracks()[0].addEventListener("ended", () => {
        console.log("Screen share ended by user");
        this.stopScreenShare();
      });

      const senders = this.activeCall.peerConn.getSenders();
      const videoSender = senders.find(
        (sender) => sender.track && sender.track.kind === "video",
      );

      if (!videoSender) {
        console.error("No video sender found");
        this.showAudioError("No video track available for screen sharing");
        screenStream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const screenVideoTrack = screenStream.getVideoTracks()[0];
      this.originalVideoTrack = videoSender.track;
      this.screenStream = screenStream;
      await videoSender.replaceTrack(screenVideoTrack);

      const localVideo = document.getElementById("local");
      if (localVideo) {
        localVideo.srcObject = screenStream;
      }

      this.isScreenSharing = true;
      this.updateScreenShareButton();

      return true;
    } catch (error) {
      console.error("Error starting screen-only share:", error);

      if (error.name === "NotAllowedError") {
        this.showAudioError("Screen sharing permission denied");
      } else if (error.name === "NotSupportedError") {
        this.showAudioError("Screen sharing not supported in this browser");
      } else {
        this.showAudioError("Failed to start screen sharing");
      }

      return false;
    }
  }

  updateScreenShareButton() {
    const screenShareButton = document.getElementById("bc-screen-share");
    if (screenShareButton) {
      if (this.isScreenSharing) {
        screenShareButton.classList.add("active");
        screenShareButton.innerHTML = '<i class="fas fa-desktop"></i>';
        screenShareButton.title = "Stop Screen Share";
      } else {
        screenShareButton.classList.remove("active");
        screenShareButton.innerHTML = '<i class="far fa-desktop"></i>';
        screenShareButton.title = "Start Screen Share";
      }
    }
  }

  async toggleScreenShare(e) {
    e.stopPropagation();

    if (!this.activeCall || this.activeCall.state !== "connected") {
      this.showAudioError("No active call for screen sharing");
      return;
    }

    if (this.isScreenSharing) {
      await this.stopScreenShare();
      return;
    }

    await this.startScreenShare();
  }

  updateInterfaceForScreenShare(screenStream) {
    const remoteScene = document.getElementById("remote-scene");
    const localVideo = document.getElementById("local");
    const remoteVideo = document.getElementById("remote");

    if (remoteScene) {
      remoteScene.classList.remove("novid");
      remoteScene.classList.remove("connecting");
    }

    if (localVideo) {
      localVideo.classList.remove("hidden");
      localVideo.srcObject = screenStream;
    }

    if (remoteVideo) {
      if (
        !remoteVideo.srcObject ||
        remoteVideo.srcObject.getVideoTracks().length === 0
      ) {
        remoteVideo.poster =
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      }
    }

    console.log("Interface updated for screen sharing");
  }

  ensureVideoAreaVisible(isVoiceCall) {
    const remoteScene = document.getElementById("remote-scene");
    const localVideo = document.getElementById("local");

    if (remoteScene) {
      remoteScene.classList.remove("novid");
      remoteScene.classList.remove("connecting");
      remoteScene.classList.add("screen-sharing");
    }

    if (localVideo) {
      localVideo.classList.remove("hidden");
      if (isVoiceCall) {
        localVideo.classList.add("screen-share-temp");
      }
    }

    console.log("Video area visible for screen sharing");
  }

  updateInterfaceAfterScreenShare(newStream) {
    const controls = document.getElementById("controls");
    const isVoiceCall = controls && controls.dataset.callType === "voice";
    const remoteScene = document.getElementById("remote-scene");
    const localVideo = document.getElementById("local");

    if (localVideo) {
      if (newStream) {
        localVideo.srcObject = newStream;
        if (isVoiceCall) {
          localVideo.classList.add("hidden");
        } else {
          localVideo.classList.remove("hidden");
        }
      } else {
        localVideo.srcObject = null;
        if (isVoiceCall) {
          localVideo.classList.add("hidden");
        }
      }
    }

    if (remoteScene && isVoiceCall && !newStream) {
      remoteScene.classList.add("novid");
    }

    console.log("Interface restored after screen sharing");
  }

  /**
   * @param {keyof CallTypes} [callType="video"]
   */
  initCordovaPermisions(callType = CallTypes.video) {
    const _isVideoCall = isVideoCall(callType);
    return new Promise((resolve, reject) => {
      if (window?.cordova) {
        function error(e) {
          console.log("Camera permission is not turned on");

          reject(e);
        }
        function success() {
          console.log("camera is turned on");
          setTimeout(() => {
            resolve();
          }, 50);
        }

        window.BSTMedia.permissions({ audio: true, video: _isVideoCall })
          .then(success)
          .catch(error);
      } else {
        (async () => {
          try {
            const isWebkit = !!navigator.webkitGetUserMedia;
            let stream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: _isVideoCall && {
                facingMode: ["user", "environment"],

                /* We want 640x360.	Chrome will give it only if we ask exactly,
									 FF refuses entirely if we ask exactly, so have to ask for ideal
									 instead
									 XXX: Is this still true?
								 */
                width: isWebkit
                  ? {
                      exact: 640,
                    }
                  : {
                      ideal: 640,
                    },
                height: isWebkit
                  ? {
                      exact: 360,
                    }
                  : {
                      ideal: 360,
                    },
              },
            });
            resolve();

            for (let track of stream.getTracks()) {
              track.stop();
            }
            console.log("resolve", stream);
            if (
              window.cordova &&
              window.plugins &&
              window.plugins.audioManagement
            ) {
              try {
                await window.plugins.audioManagement.configureAudioSession({
                  category: "playAndRecord",
                  mode: "voiceChat",
                  options: ["allowBluetooth", "allowBluetoothA2DP"],
                });
              } catch (error) {
                console.error("Audio session configuration failed:", error);
              }
            }
          } catch (e) {
            console.log("reject", e);
            reject(e);
          }
        })();
      }
    });
  }

  stopAllMediaTracks() {
    try {
      if (this.activeCall?.peerConn) {
        const senders = this.activeCall.peerConn.getSenders();
        senders.forEach((sender) => {
          if (sender.track) {
            sender.track.stop();
          }
        });
      }

      const localVideo = document.getElementById("local");
      if (localVideo && localVideo.srcObject) {
        localVideo.srcObject.getTracks().forEach((track) => track.stop());
        localVideo.srcObject = null;
      }

      if (this.cameraStream) {
        this.cameraStream.getTracks().forEach((track) => track.stop());
        this.cameraStream = null;
      }

      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }
    } catch (error) {
      console.error("Error stopping media tracks:", error);
    }
  }
}

if (typeof retry == "undefined") {
  var retry = function (_function, clbk, time, totaltime) {
    if (_function()) {
      if (clbk) clbk();

      return;
    }

    if (!time) time = 20;

    var totalTimeCounter = 0;

    var interval = setInterval(function () {
      if (_function() || (totaltime && totaltime <= totalTimeCounter)) {
        clearInterval(interval);

        if (clbk) clbk();
      }

      totalTimeCounter += time;
    }, time);
  };

  var pretry = function (_function, time, totaltime) {
    return new Promise((resolve, reject) => {
      retry(_function, resolve, time, totaltime);
    });
  };
}

window.BastyonCalls = BastyonCalls;
export default BastyonCalls;
