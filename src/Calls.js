import {EventEmitter} from 'events';
import "./scss/index.sass";
import {logPlugin} from "@babel/preset-env/lib/debug";


class BastyonCalls extends EventEmitter {

	constructor(client, matrixcs, root, options){
		super()
		this.client = client;
		this.matrixcs = matrixcs;
		this.initEvents()
		this.initSignals()
		this.initTemplates(root)
		this.options = options
	}

	controls = {}
	isFrontalCamera = false
	videoStreams = null
	isMuted = false
	activeCall = null
	secondCall = null
	syncInterval = null
	isWaitingForConnect = false
	signal = null
	timer = null
	timeInterval = null
	title = null
	templates = {
		incomingCall : function(){
			return `
			<div class="bc-incoming-call">
				<div class="user">
					<div class="avatar">
						${this.getAvatar()}
					</div>
					<div class="title">
						<div class="name">${this.activeCall.initiator.source.name}</div>
						<div class="description">${this.options.getWithLocale('incomingCall')}</div>
					</div>
				</div>
				<div class="buttons">
					<button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
					<button class="bc-btn bc-answer" id="bc-answer"><i class="fas fa-phone"></i></button>
				</div>
			</div>
		`
		},
		endedCall : function(call){
			return `	
			<div class="bc-ended-call">
				<div class="avatar">
						${this.getAvatar()}
				</div>
				<div class="name">${this.activeCall.initiator.source.name}</div>
				<div class="description">${this.options.getWithLocale('endedCall')}</div>
			</div>`
		},

		videoCall : function(){
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
					<button class="bc-btn bc-cog" id="bc-cog"><i class="fas fa-cog"></i></button>
					<button class="bc-btn bc-pip" id="bc-pip"><i class="fas fa-images"></i></button>
					<button class="bc-btn bc-format" id="bc-format"><i class="fas"></i></button>
				</div>
			</div>
			<div class="bc-video-container">
				<div class="bc-video active novid" id="remote-scene">
					<video id="remote" pip="false" autoplay playsinline ></video>
					<div class="avatar">${this.getAvatar()}</div>
				</div>
				<div class="bc-video minified">
					<video id="local" pip="false" autoplay playsinline ></video>
				</div>
			</div>
			<div class="bc-controls">
				<button class="bc-btn bc-camera" id="bc-camera"><i class="fas fa-sync-alt"></i></button>
				<button class="bc-btn bc-hide" id="bc-hide"><i class="fas fa-video"></i></button>
				<button class="bc-btn bc-mute" id="bc-mute"><i class="fas fa-microphone"></i></button>
				<button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
				<button class="bc-btn bc-expand" id="bc-expand"><i class="fas fa-expand"></i></button>
			</div>
		`
		}

	}

	renderTemplates = {

		videoCall : () => {
			console.log('videoCall')
			this.root.classList.add('middle')
			// this.root.classList.add('active')
			this.root.innerHTML = this.templates['videoCall']?.call(this) || ''
			this.initCallInterface('videoCall')
		},
		incomingCall: (call) => {
			this.notify.innerHTML = this.templates['incomingCall']?.call(this) || ''
			this.initCallInterface('incomingCall', call)
		},
		clearNotify : () => {
			console.log('clearNotify')
			this.notify.innerHTML = ''
		},
		clearVideo : () => {
			console.log('clearVideo')
			this.root.innerHTML = ''
		},
		clearInterface : () => {
			console.log('clearInterface')
			this.root.classList.remove('active')
			this.root.classList.remove('minified')
			this.root.classList.remove('middle')
			this.root.classList.remove('full')
		},
		endedCall : (call) => {
			if (this.root.classList.contains('minified')) {
				this.root.classList.remove('minified')
				this.root.classList.add('middle')
			}

			this.root.innerHTML = this.templates['endedCall']?.call(this,call) || ''
		}
	}

	initTemplates(outerRoot){
		console.log(outerRoot)
		outerRoot.insertAdjacentHTML('beforeend', `<div class="bc-container"><div id="bc-notify" class="bc-notify"></div><div id="bc-root"></div></div>`);
		this.root = document.getElementById('bc-root')
		this.notify = document.getElementById('bc-notify')
		if (window) {
			window.onunload = () => {
				if(this.activeCall) {
					this.activeCall.hangup()
				}
			}
		}
	}


	initEvents(){
		this.client.on("Call.incoming", async (call) => {
			console.log('incoming', call, call.hangupParty, call.hangupReason)
			// if(call.hangupParty || call.hangupReason) {
			// 	console.log('bad____________')
			// 	return
			// }
			this.title = document.querySelector('title').innerHTML
			document.querySelector('title').innerHTML = this.options.getWithLocale('incomingCall')
			this.emit('initcall____________')

			let members = this.client.store.rooms[ call.roomId ].currentState.members
			let initiatorId = Object.keys(members).filter(m => m !== this.client.credentials.userId)
			let initiator = members[ initiatorId ]
			let user = members[this.client.credentials.userId]

			call.initiator = initiator
			call.user = user
			this.options.getUserInfo(initiator.userId).then((res) => {
				 initiator.source = res[0] || res
				 this.addCallListeners(call)
				 if (!this.activeCall) {
					 this.activeCall = call
				 } else if(!this.secondCall){
					 this.secondCall = call
					 console.log('nwe call in queue', call)
				 } else {
					 call.hangup('busy')
					 call.reject('busy')
				 }
				let a = new Audio('js/lib')
				a.autoplay = true
				a.loop = true

				this.signal = a
				this.renderTemplates.incomingCall(call)
				this.signal.src='sounds/incoming.mp3'
			 })


		});


	}

	initSignals() {
		this.signal = new Audio()
	}
	clearTimer() {
		this.timer = null
		clearInterval(this.timeInterval)
		this.timeInterval = null
	}
	initTimer() {
		this.timer = 0
		let el = document.getElementById('time')
		this.timeInterval = setInterval((function (){
			this.timer++
			let m = Math.floor(this.timer/60)
			let s = this.timer % 60
			el.innerHTML = `${m}:${ s>=10 ? s : '0'+s}`
		}).bind(this), 1000)
	}
	answer(){
		try {
			if (this.activeCall.state === "ringing") {
				this.activeCall.answer()
				console.log('Ответ на',this.activeCall)
				this.signal.pause()
				this.renderTemplates.clearNotify()
				this.renderTemplates.videoCall()
			} else {
				this.isWaitingForConnect = true
				this.renderTemplates.clearNotify()
				this.activeCall.hangup()
				setTimeout(()=> {
					try {
						console.log('Сброс + ответ на', this.activeCall)
						this.activeCall.answer()
						this.signal.pause()
						this.isWaitingForConnect = false
						this.renderTemplates.videoCall()
					} catch (e) {
						console.log("Ошибка при ответе на вторую линию", e)
						this.signal.pause()
					}
				}, 1000)
			}

		} catch (e) {
			// this.renderTemplates.clearNotify()
			// this.renderTemplates.clearVideo()
			// this.renderTemplates.clearInterface()
			console.log('error answer',e)
			this.signal.pause()
		}
	}

	initsync() {
		let container = document.querySelector('.bc-video-container')
		this.activeCall.peerConn.getStats(null).then((stats) => {
			let filtered = [...stats].filter(r=> {
				return r[1].type === 'candidate-pair'
			})
			filtered.forEach(c => {
				console.log(stats.get(c.selectedCandidatePairId))
			})
		})
		this.syncInterval = setInterval((function(){


			if(this?.activeCall?.remoteStream) {
				let track = this?.activeCall?.remoteStream.getVideoTracks()[0]
				if(this.root.classList.contains('minified')){
					let aspectRatio = track.getSettings().aspectRatio
					if (aspectRatio){
						container.style.aspectRatio = aspectRatio
						if (aspectRatio < 1) {
							container.classList.add('vertical')
						} else {
							container.classList.remove('vertical')
						}
					}
				}
			}
		}).bind(this),1000)
	}

	// play(e){
	// 	e.target.play().catch(console.log)
	// }

	mute(e){

		e.stopPropagation()

		let sender = this.activeCall.peerConn.getSenders().find((s) => {
			return s.track.kind === 'audio';
		})

		let control = document.querySelector('.bc-mute')
		if (sender.track.enabled) {
			control.firstChild.classList.remove('fa-microphone')
			control.classList.add('active')
			control.firstChild.classList.add('fa-microphone-slash')

		} else {
			control.firstChild.classList.remove('fa-microphone-slash')
			control.classList.remove('active')
			control.firstChild.classList.add('fa-microphone')
		}
		sender.track.enabled = !sender.track.enabled

		console.log('mute',this.activeCall.peerConn.getSenders())
	}

	hide(e){
		e.stopPropagation()
		let sender = this.activeCall.peerConn.getSenders().find((s) => {
			return s.track?.kind === 'video' || !s.track
		})

		let control = document.querySelector('.bc-hide')
		if (sender.track.enabled) {
			control.firstChild.classList.remove('fa-video')
			control.classList.add('active')
			control.firstChild.classList.add('fa-video-slash')
		} else {
			control.firstChild.classList.remove('fa-video-slash')
			control.classList.remove('active')
			control.firstChild.classList.add('fa-video')
		}

		sender.track.enabled = !sender.track.enabled

		console.log('hide',this.activeCall.peerConn.getSenders(), this.activeCall.peerConn.getReceivers())
		console.log('remote tracks',this.activeCall.remoteStream.getTracks())

	}

	cameraCount() {
		navigator.mediaDevices.enumerateDevices().then((devices) => {
			let cameras = devices.filter(d => d.kind === 'videoinput')
			console.log(cameras)
			if(cameras.length <= 1){
				document.getElementById("bc-camera").style.display = 'none'
				console.log('no cameras')
			}
		})
	}

	camera(e) {
		let self = this

		try {
			navigator.mediaDevices.enumerateDevices().then( (dev) => {
				let video = dev.filter(d => d.kind === 'videoinput')
				let target
				const senders = self.activeCall.peerConn.getSenders()
				console.log('senders', senders)
				let sender = senders.find((s) => {
					return s.track.kind == 'video';
				})
				console.log('sender', sender)

				if (sender && sender?.label?.includes('front' || 'передней')){
					console.log('Front camera is active')
					self.isFrontalCamera = true
				}
				console.log('video list', video)

				if (video.length > 1) {

					if (sender.track.label.includes('front') || sender.track.label.includes('передней')) {
						console.log('to back')
						target = video.reverse().find((device) => {
							return device.label.includes('back') || device.label.includes('задней')
						})
					} else {
						console.log('to front')
						target = video.find((device) => {
							return device.label.includes('front') || device.label.includes('передней')
						})
					}

				} else return

				let videoConstraints = {}
				videoConstraints.deviceId = { exact: target.deviceId }

				const constraints = {
					video: videoConstraints,
					audio: false
				};
				navigator.mediaDevices
				  .getUserMedia(constraints)
				  .then(stream => {
					  stream.getTracks().forEach(function(track) {
						  console.log('track', track)
						  const sender = self.activeCall.peerConn.getSenders().find((s) => {
							  return s.track.kind == track.kind;
						  })
						  console.log('current stream ', sender)
						  if (sender.track.label === track.label) {
							  console.log('same streams on change')
							  return
						  }
						  if (track.muted) {
							  console.log('track is unable', track)
						  }
						  sender.replaceTrack(track);
						  self.videoStreams.local.srcObject = stream

					  })
					  this.hide()
				  }).catch(function(error) {

					console.log("Const stream: " + error.message);
				})

			}).catch(function(error) {

				console.log( "Check: " + error.message);
			})
		} catch (e) {

			console.log('sa',e)
		}

	}

	format() {
		if (this.root.classList.contains('middle')) {
			this.root.classList.remove('middle')
			this.root.classList.add('full')
		} else if (this.root.classList.contains('full')) {
			this.root.classList.remove('full')
			this.root.classList.add('middle')
		}
	}
	pip() {
		if (this.root.classList.contains('middle')) {
			this.root.classList.remove('middle')
			this.root.classList.add('minified')
		} else if (this.root.classList.contains('full')) {
			this.root.classList.remove('full')
			this.root.classList.add('minified')
		} else {
			clearInterval(this.syncInterval)
			console.log('interval',this.syncInterval)
			this.root.classList.remove('minified')
			this.root.classList.add('middle')
		}
	}

	async initCall(roomId){
		this.emit('initcall')

		if (this.activeCall && this?.activeCall?.roomId === roomId) {
			console.log('Call is already init', this)
			return
		}

		const call = matrixcs.createNewMatrixCall(this.client, roomId)

		call.placeVideoCall(document.getElementById("remote"),document.getElementById("local")).then( (async function() {
			let members = this.client.store.rooms[ call.roomId ].currentState.members
			let initiatorId = Object.keys(members).filter(m => m !== this.client.credentials.userId)
			let initiator = members[ initiatorId ]
			let user = members[this.client.credentials.userId]

			call.initiator = initiator
			call.user = user

			initiator.source = await this.options.getUserInfo(initiator.userId)[0]
			this.options.getUserInfo(initiator.userId).then((res) => {
				console.log(res)
				initiator.source = res[0] || res


				this.signal.src='sounds/calling.mp3'
				this.renderTemplates.videoCall()
			}).catch(e => console.log('get user info error',e))
		}).bind(this))

		this.addCallListeners(call)

		if (!this.activeCall) {
			this.activeCall = call
		} else {
			console.log('You have active call')
			return
		}

		let a = new Audio('js/lib')
		a.autoplay = true
		a.loop = true
		this.signal = a

		return call
	}

	hexDecode(hex) {
		var ch = 0;
		var result = "";
		for (var i = 2; i <= hex.length; i += 2) {
			ch = parseInt(hex.substring(i - 2, i), 16);
			if (ch >= 128) ch += 0x350;
			ch = String.fromCharCode("0x" + ch.toString(16));
			result += ch;
		}
		return result;
	}

	hangup(e){
		e.stopPropagation()
		this.activeCall.hangup('ended', false)
		this.renderTemplates.clearVideo()
		console.log('hangup')
		this.signal.pause()
	}

	reject(call){
		call.hangup()
		call.reject('busy')
		this.signal.pause()
	}

	// changeView(event){
	// 	if(this.root.classList.contains('minified')){
	// 		this.minimize()
	// 		return
	// 	}
	// }

	initCallInterface(type, call){

		switch (type) {
			case 'incomingCall':
				document.getElementById("bc-answer").addEventListener('click', this.answer.bind(this))
				document.getElementById("bc-decline").addEventListener('click', () => this.reject(call))
				break;
			case 'videoCall':
				this.videoStreams = {
					remote : document.getElementById("remote"),
					local : document.getElementById("local")
				}
				try {
					console.log('init call interface',this.activeCall)
					this.activeCall.setLocalVideoElement(this.videoStreams.local)
					this.activeCall.setRemoteVideoElement(this.videoStreams.remote)
					this.cameraCount()
					this.addVideoInterfaceListeners()
					console.log('стримы',this.videoStreams)
				} catch (e) {
					console.log('init interface error',e)
				}
				break;
		}
	}

	addVideoInterfaceListeners(){
		// this.videoStreams.local.addEventListener('click', (e) => this.changeView.call(this, e))
		document.getElementById("remote-scene").addEventListener('click', (e) => this.pip.call(this, e))
		document.getElementById("bc-decline").addEventListener('click', (e) => this.hangup.call(this,e))
		document.getElementById("bc-mute").addEventListener('click', (e) => this.mute.call(this,e))
		document.getElementById("bc-hide").addEventListener('click', (e) => this.hide.call(this,e))
		document.getElementById("bc-camera").addEventListener('click', (e) => this.camera.call(this,e))
		document.getElementById("bc-expand").addEventListener('click', (e) => this.pip.call(this,e))
		document.getElementById("bc-cog").addEventListener('click', (e) => this.settings.call(this,e))
		document.getElementById("bc-format").addEventListener('click', (e) => this.format.call(this,e))
		document.getElementById("bc-pip").addEventListener('click', (e) => this.pip.call(this,e))
		// this.root.addEventListener('click',(e) => this.play.call(this,e))


	}

	addCallListeners(call){

		call.on('state', (a,b) => {
			console.log('state', a)
			if (a === 'connected') {
				this.showRemoteVideo()
				if (!this.timeInterval) {
					this.initTimer()
				}
				this.signal.pause()
				console.log('connected',this.activeCall)
				document.querySelector('title').innerHTML = this.title
				this.initsync()
			}
			if (a === 'ended') {
				this.clearTimer()
				clearInterval(this.syncInterval)
				this.syncInterval = null
				this.signal.pause()
				document.querySelector('title').innerHTML = this.title
			}
		})
		call.on("hangup", (call) => {

			clearInterval(this.syncInterval)
			this.syncInterval = null
			console.log('Call ended',call)
			if (!call) {
				this.renderTemplates.clearNotify()
			}
			if (call.callId === this.secondCall?.callId) {
				this.secondCall = null
				this.renderTemplates.clearNotify()
				console.log('second line ended', call)
			}
			if (call.callId === this.activeCall?.callId) {

				console.log('first line ended', this)

				if(this.isWaitingForConnect) {
					this.activeCall = this.secondCall
					this.secondCall = null
					console.log('second line is active', this.activeCall)
					return;
				}
				this.renderTemplates.clearVideo()
				this.renderTemplates.clearNotify()
				if (call.hangupParty === "local" || call.localVideoElement) {
					if (this.root.classList.contains('minified') || !this.root.classList.length) {
						this.renderTemplates.clearVideo()
						this.renderTemplates.clearInterface()
						this.activeCall = null
						return
					}
					this.renderTemplates.endedCall(call)
					if (call.hangupReason = "user_hangup" && !call.remoteStream && call.hangupParty !== 'local') {
						console.log('busy', this.signal)
						this.signal.loop = false
						this.signal.src = 'sounds/busy.mp3'
					}
					setTimeout(() => {
						this.renderTemplates.clearVideo()
						this.renderTemplates.clearInterface()
						this.activeCall = null
						console.log(this.activeCall)
					}, 3000)
					return
				}
				this.signal.pause()
				this.renderTemplates.clearInterface()

			}


		});
		call.on("error", (err) => {
			console.log('s',this)
			console.log('some error',err)
			this.lastError = err.message;
			call.hangup('error');
			this.signal.pause()
			this.renderTemplates.clearVideo()
			this.emit('error', err)
		});
	}


	getAvatar() {
		if(this.activeCall.initiator?.source?.image){
			return `<img src="${this.activeCall.initiator.source.image}"/>`
		}
		return this.activeCall.initiator.source.name[0].toUpperCase()
	}

	showRemoteVideo() {
		document.getElementById('remote-scene').classList.remove('novid')
	}

}

window.BastyonCalls = BastyonCalls
export default BastyonCalls