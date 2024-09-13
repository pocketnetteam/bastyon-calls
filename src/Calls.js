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
		console.log("ss", client, matrixcs);
		console.log("dd", matrixcs);
	}

	controls = {};
	isFrontalCamera = false;
	videoStreams = null;
	isMuted = false;
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
							callTypeDescriptionKey
						)}</div>
					</div>
				</div>
				<div class="buttons">
					<button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
					${
						_isVideoCall &&
						'<button class="bc-btn bc-answer" id="bc-answer-video"><i class="fa fa-video"></i></button>'
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
<!--					<button class="bc-btn bc-cog" id="bc-cog"><i class="fas fa-cog"></i></button>-->
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
				<div class="bc-video minified">
					<video id="local" muted pip="false" autoplay playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
				</div>
			</div>
			<div class="bc-controls" data-call-type="video" id="controls">
				<button class="bc-btn bc-camera" id="bc-camera"><i class="fas fa-sync-alt"></i></button>
				<button class="bc-btn bc-video-on" id="bc-video-on"><i class="fas fa-video"></i></button>
				<button class="bc-btn bc-video-off" id="bc-video-off"><i class="fas fa-video-slash"></i></button>
				<button class="bc-btn bc-mute" id="bc-mute"><i class="fas fa-microphone"></i></button>
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
<!--					<button class="bc-btn bc-cog" id="bc-cog"><i class="fas fa-cog"></i></button>-->
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
				<div class="bc-video minified">
					<video id="local" class="hidden" muted pip="false" autoplay playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
				</div>
			</div>
			<div data-call-type="voice" class="bc-controls voice" id="controls">
				<button class="bc-btn bc-camera" disabled id="bc-camera"><i class="fas fa-sync-alt"></i></button>
				<button class="bc-btn bc-video-on" id="bc-video-on"><i class="fas fa-video"></i></button>
				<button class="bc-btn bc-video-off" id="bc-video-off"><i class="fas fa-video-slash"></i></button>
				<button class="bc-btn bc-mute" id="bc-mute"><i class="fas fa-microphone"></i></button>
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
			`<div class="bc-container" id="bc-container"><div id="bc-notify" class="bc-notify"></div><div id="bc-root"></div></div>`
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
				(m) => m !== this.client.credentials.userId
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
						let a = new Audio("js/lib");
						a.autoplay = true;
						a.loop = true;
						a.volume = 0.5;

						this.signal = a;

						this.signal.src = "sounds/incoming.mp3";
						this.renderTemplates.incomingCall(call);

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

				let a = new Audio("js/lib");
				a.autoplay = true;
				a.loop = true;
				a.volume = 0.5;

				this.signal = a;
				this.renderTemplates.incomingCall(call);
				this.signal.src = "sounds/incoming.mp3";
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
			1000
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

	updateCall(callType) {
		const _isVideoCall = isVideoCall(callType);
		if (_isVideoCall) this.activeCall.upgradeCall(true, true);
		else this.activeCall.setLocalVideoMuted(true);
		this.renderTemplates.call(callType);
	}
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
					}
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
							stream.getTracks().forEach(function (track) {
								// console.log('track', track)
								const sender = self.activeCall.peerConn
									.getSenders()
									.find((s) => {
										return s.track.kind == track.kind;
									});
								// console.log('current stream ', sender)
								if (sender.track.label === track.label) {
									// console.log('same streams on change')
									return;
								}
								if (track.muted) {
									// console.log('track is unable', track)
								}
								sender.replaceTrack(track);
								sender.track.stop();
								self.videoStreams.local.srcObject = stream;
							});
							this.hide();
						})
						.catch(function (error) {
							// console.log("Const stream: " + error.message);
						});
				})
				.catch(function (error) {
					// console.log( "Check: " + error.message);
				});
		} catch (e) {
			// console.log('sa',e)
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
								e.clientY - shiftTop
							);
						}
					} else if (
						window.innerHeight - this.root.getBoundingClientRect().bottom <=
							10 &&
						e.movementY < 0
					) {
						this.root.style.top = this.getPercents(
							"height",
							window.innerHeight - this.root.offsetHeight - 11
						);
					} else {
						console.log(
							"y out",
							window.innerHeight - this.root.getBoundingClientRect().bottom,
							e.clientY - shiftTop
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
								e.pageX - shiftLeft
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
							document.body.clientWidth - this.root.offsetWidth - 71
						);
					} else {
						console.log(
							"x out",
							document.body.clientWidth -
								this.root.getBoundingClientRect().left -
								this.root.offsetWidth
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
					})
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
					})
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
				(m) => m !== this.client.credentials.userId
			);

			let initiator = members[initiatorId];

			let user = members[this.client.credentials.userId];

			return this.options.getUserInfo(initiator.userId).then((res) => {

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
				})
					
			})
			.catch((e) => {
				console.log("get user info error", e);
				return Promise.reject(e)
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
		this.renderTemplates.clearVideo();

		this.signal.pause();
	}

	reject(call) {
		call.reject("busy");
		this.signal.pause();
	}
	setLocalElement() {
		const st = this.activeCall.feeds.find(
			(f) => f.userId === this.activeCall.user.userId
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
			(f) => f.userId !== this.activeCall.user.userId
		)?.stream;
		try {
			st && document.getElementById("remote")
				? (document.getElementById("remote").srcObject = st)
				: null;
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
					.addEventListener("click", () => this.answer(CallTypes.video));
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
			?.addEventListener("click", (e) =>
				this.updateCall.call(this, CallTypes.voice)
			);
		document
			.getElementById("bc-video-off")
			?.addEventListener("click", (e) =>
				this.updateCall.call(this, CallTypes.video)
			);
		document
			.getElementById("bc-camera")
			?.addEventListener("click", (e) => this.camera.call(this, e));
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
		// document.getElementById("bc-cog").addEventListener('click', (e) => this.settings.call(this,e))
		// this.root.addEventListener('click',(e) => this.play.call(this,e))
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
			if (isCallNegotiationEvent) {
				this.updateCallElements();
				this.initsync();
			}
		});
		call.on("state", (a, b) => {
			console.log("state", a, call);

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
				(m) => m !== this.client.credentials.userId
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
						1000
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
					} catch (e) {
						console.log("reject", e);
						reject(e);
					}
				})();
			}
		});
	}
}
	
if(typeof retry == 'undefined'){
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
