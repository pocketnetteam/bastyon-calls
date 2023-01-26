import {EventEmitter} from 'events';
import "./scss/index.sass";

class BastyonCalls extends EventEmitter {

	constructor(client, matrixcs, root, options){
		super()
		this.client = client;
		this.matrixcs = matrixcs;
		this.initEvents()
		this.initSignals()
		this.initTemplates(root)
		/*this.initCordovaPermisions()*/ /// TODO
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
	blinkInterval = null
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
					<button class="bc-btn bc-pip" id="bc-pip"><i class="fas fa-minus"></i></button>
					<button class="bc-btn bc-format" id="bc-format"><i class="fas"></i></button>
				</div>
			</div>
			<div class="bc-video-container">
				<div class="bc-video active novid" id="remote-scene">
					<video id="remote" pip="false" autoplay playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
					<div class="avatar">${this.getAvatar()}</div>
				</div>
				<div class="bc-video minified">
					<video id="local" pip="false" autoplay playsinline poster="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="></video>
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
			// console.log('videoCall')
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
			// console.log('clearNotify')
			this.notify.innerHTML = ''
		},
		clearVideo : () => {
			// console.log('clearVideo')
			this.root.innerHTML = ''
		},
		clearInterface : () => {
			// console.log('clearInterface')
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
		// console.log(outerRoot)
		outerRoot.insertAdjacentHTML('beforeend', `<div class="bc-container"><div id="bc-notify" class="bc-notify"></div><div id="bc-root"></div></div>`);
		this.root = document.getElementById('bc-root')
		this.notify = document.getElementById('bc-notify')
		if (window) {
			window.onbeforeunload = () => {
				if(this.activeCall) {
					this.activeCall.hangup()
				}
			}
		}
	}


	initEvents(){
		this.client.on("Call.incoming", async (call) => {

			console.log('incoming call')
			// console.log('init call', this.activeCall, call)
			// if (this.activeCall && this?.activeCall?.roomId === roomId) {
			//
			// 	console.log('same room call',this)
			// 	if (this.activeCall.state === "ringing") {
			// 		console.log('has active, with ringing')
			// 		this.answer()
			// 	}
			// 	if (this.activeCall.state === "ended") {
			// 		console.log('has active, with ended')
			// 		this.activeCall = null
			// 	}
			// 	return
			// }

			this.setBlinking()
			this.emit('initcall')
			if(this?.options?.onIncomingCall) {
				this.options.onIncomingCall(call)
			}

			let members = this.client.store.rooms[ call.roomId ].currentState.members
			let initiatorId = Object.keys(members).filter(m => m !== this.client.credentials.userId)
			let initiator = members[ initiatorId ]
			let user = members[this.client.credentials.userId]

			call.initiator = initiator
			call.user = user
			this.options.getUserInfo(initiator.userId).then((res) => {
				if (call.hangupParty || call.hangupReason) {
					return
				}
				 initiator.source = res[0] || res
				 this.addCallListeners(call)
				 if (!this.activeCall) {
					 this.activeCall = call
				 } else if(!this.secondCall){
					 this.secondCall = call
					 // console.log('nwe call in queue', call)
				 } else {
					 call.hangup('busy')
					 call.reject('busy')
					 // console.log('all calls', this)
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
		console.log('state on answer', this.activeCall.state)

		this.signal?.pause()

		this.initCordovaPermisions().then(() => {

			try {
				if (this.activeCall.state !== "connected" || this.activeCall.state !== "ended") {
					
					console.log('response', this.activeCall)
					
					this.activeCall.answer()
					this.renderTemplates.clearNotify()
					this.renderTemplates.videoCall()
				
					
				} else {
					this.isWaitingForConnect = true
					this.renderTemplates.clearNotify()
					this.activeCall.hangup()
					setTimeout(()=> {
						try {


							this.activeCall.answer()
							this.isWaitingForConnect = false
							this.renderTemplates.videoCall()

							
						} catch (e) {
							console.error("Ошибка при ответе на вторую линию", e)
						}
					}, 1000)
				}

			} catch (e) {
				return Promise.reject(e)
			}

			return Promise.resolve()

		}).catch(e => {
			console.error(e)
		})
	}

	initsync() {
		let container = document.querySelector('.bc-video-container')
		this.activeCall.peerConn.getStats(null).then((stats) => {
			let filtered = [...stats].filter(r=> {
				return r[1].type === 'candidate-pair'
			})
			filtered.forEach(c => {
				// console.log(stats.get(c.selectedCandidatePairId))
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

		// console.log('mute',this.activeCall.peerConn.getSenders())
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

		// console.log('hide',this.activeCall.peerConn.getSenders(), this.activeCall.peerConn.getReceivers())
		// console.log('remote tracks',this.activeCall.remoteStream.getTracks())

	}

	cameraCount() {
		navigator.mediaDevices.enumerateDevices().then((devices) => {
			let cameras = devices.filter(d => d.kind === 'videoinput')
			// console.log(cameras)
			if(cameras.length <= 1){
				document.getElementById("bc-camera").style.display = 'none'
				// console.log('no cameras')
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
				// console.log('senders', senders)
				let sender = senders.find((s) => {
					return s.track.kind === 'video';
				})
				// console.log('sender', sender)

				if (sender && sender?.label?.includes('front' || 'передней')){
					// console.log('Front camera is active')
					self.isFrontalCamera = true
				}
				// console.log('video list', video)

				if (video.length > 1) {

					if (sender.track.label.includes('front') || sender.track.label.includes('передней')) {
						// console.log('to back')
						target = video.reverse().find((device) => {
							return device.label.includes('back') || device.label.includes('задней')
						})
					} else {
						// console.log('to front')
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
						  // console.log('track', track)
						  const sender = self.activeCall.peerConn.getSenders().find((s) => {
							  return s.track.kind == track.kind;
						  })
						  // console.log('current stream ', sender)
						  if (sender.track.label === track.label) {
							  // console.log('same streams on change')
							  return
						  }
						  if (track.muted) {
							  // console.log('track is unable', track)
						  }
						  sender.replaceTrack(track);
						  self.videoStreams.local.srcObject = stream

					  })
					  this.hide()
				  }).catch(function(error) {

					// console.log("Const stream: " + error.message);
				})

			}).catch(function(error) {

				// console.log( "Check: " + error.message);
			})
		} catch (e) {
			// console.log('sa',e)
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
			// console.log('interval',this.syncInterval)
			this.root.classList.remove('minified')
			this.root.classList.add('middle')
		}
	}

	initCall(roomId){

		if (this?.activeCall?.roomId === roomId) {
			console.log('only one call in room')
			if (this?.activeCall?.state === "ringing") {
				console.log('answer to incoming from same room')
				this.answer()
			}
			return Promise.reject()
		}


		return this.initCordovaPermisions().then(() => {
			this.emit('initcall')

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
					initiator.source = res[0] || res
					this.signal.src='sounds/calling.mp3'
					this.renderTemplates.videoCall()
				}).catch(e => console.log('get user info error',e))
			}).bind(this))

			this.addCallListeners(call)
			// console.log('after init',this.activeCall)
			if (!this.activeCall) {
				this.activeCall = call
			} else {
				// console.log('You have active call',this.activeCall)
				return
			}

			let a = new Audio('js/lib')
			a.autoplay = true
			a.loop = true
			this.signal = a

			return call
		})

		
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
		// console.log('hangup', this.activeCall)
		this.activeCall.hangup('ended', false)
		this.renderTemplates.clearVideo()

		this.signal.pause()
	}

	reject(call){
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
					// console.log('init call interface',this.activeCall)
					this.activeCall.setLocalVideoElement(this.videoStreams.local)
					this.activeCall.setRemoteVideoElement(this.videoStreams.remote)
					this.cameraCount()
					this.addVideoInterfaceListeners()
					// console.log('стримы',this.videoStreams)
				} catch (e) {
					// console.log('init interface error',e)
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
			console.log('state',a, call)
			if (a === 'connected') {
				this.signal.pause()
				this.showRemoteVideo()
				if (!this.timeInterval) {
					this.initTimer()
				} else {
					this.signal.loop = false
					this.signal.src = 'sounds/connected.mp3'
				}
				this.clearBlinking()
				this.initsync()
				if(this?.options?.onConnected) {
					this.options.onConnected(call)
				}

			}
			if (a === 'ended') {
				this.clearTimer()
				clearInterval(this.syncInterval)
				this.syncInterval = null
				this.signal.pause()
				this.clearBlinking()
				if(this?.options?.onEnded) {
					this.options.onEnded(call)
				}
			}
		})
		call.on("hangup", (call) => {

			console.log('hangup', call)
			this.signal.loop = false
			this.signal.src = 'sounds/hangup.mp3'
			clearInterval(this.syncInterval)
			this.syncInterval = null
			// console.log('Call ended',call)
			if (!call) {
				this.renderTemplates.clearNotify()

				return
			}

			if (call.callId === this.secondCall?.callId) {
				this.secondCall = null
				this.renderTemplates.clearNotify()
				// console.log('second line ended', call)
			}

			if (call.callId === this.activeCall?.callId) {

				// console.log('first line ended', this)


				if(this.isWaitingForConnect) {
					this.activeCall = this.secondCall
					this.secondCall = null
					// console.log('second line is active', this.activeCall)
					return;
				}
				this.renderTemplates.clearVideo()
				this.renderTemplates.clearNotify()

				if (call.hangupParty === "local" || call.localVideoElement) {
					if (this.root.classList.contains('minified') || !this.root.classList.length) {
						//this.renderTemplates.clearVideo()
						this.renderTemplates.clearInterface()
						this.activeCall = null
						return
					}
					this.renderTemplates.endedCall(call)
					if (call.hangupReason === "user_hangup" && !call.remoteStream && call.hangupParty !== 'local') {
						// console.log('busy', this.signal)
						this.signal.loop = false
						this.signal.src = 'sounds/busy.mp3'
					}
					setTimeout(() => {
						//this.renderTemplates.clearVideo()
						this.renderTemplates.clearInterface()
						this.activeCall = null
						// console.log('time out',this.activeCall)
					}, 3000)
					return
				}

				console.log("this.activeCall = null")

				this.signal.pause()
				this.renderTemplates.clearInterface()
				this.activeCall = null

			}


		});
		call.on("replaced", (call) => {
			console.log('replaced',call)
			console.log('old',this.activeCall)
			this.activeCall = null
			this.signal.pause()
			let members = this.client.store.rooms[ call.roomId ].currentState.members
			let initiatorId = Object.keys(members).filter(m => m !== this.client.credentials.userId)
			let initiator = members[ initiatorId ]
			let user = members[this.client.credentials.userId]

			call.initiator = initiator
			call.user = user
			this.options.getUserInfo(initiator.userId).then((res) => {
				if (call.hangupParty || call.hangupReason) {
					return
				}
				initiator.source = res[0] || res
				this.addCallListeners(call)
				console.log('listen added',this ,call)
				if (!this.activeCall) {
					this.activeCall = call
					console.log('now active', this.activeCall )
				} else if(!this.secondCall){
					this.secondCall = call
					console.log('now second', this.secondCall )
					// console.log('nwe call in queue', call)
				} else {
					console.log('all lines')
					call.hangup('busy')
					call.reject('busy')
					// console.log('all calls', this)
				}
				if(call.state === 'wait_local_media') {
					console.log('wait media!')
					setTimeout((function(){this.answer()}).bind(this), 1000)
				} else {
					this.renderTemplates.videoCall()
					this.showRemoteVideo()
					call.answer()
				}

			})

		})
		call.on("error", (err) => {
			console.error('some error',err, this)
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
	setBlinking() {
		this.title = document.querySelector('title').innerHTML
		let currentTitle = this.title
		this.blinkInterval = setInterval((function() {
			console.log(this, currentTitle)
			if (currentTitle === this.title) {
				currentTitle = this.options.getWithLocale('incomingCall')
			} else {
				currentTitle = this.title
			}
			document.querySelector('title').innerHTML = currentTitle
		}).bind(this),1000)
	}
	clearBlinking() {
		clearInterval(this.blinkInterval)
		this.blinkInterval = null
		document.querySelector('title').innerHTML = this.title

	}


	initCordovaPermisions() {

		return new Promise((resolve, reject) => {
			if (window?.cordova) {
				const permissions = cordova.plugins.permissions;
				const permList = [
					permissions.CAMERA,
					permissions.RECORD_AUDIO
				];
				permissions.requestPermissions(permList, success, error);

				function error(e) {
					console.log('Camera permission is not turned on');

					reject(e)
				}
				function success() {
					console.log('camera is turned on')
					setTimeout(() => {
						resolve()
					}, 50)
					
				}
			}
			else{
				resolve()
			}

			
		})

		
	}
}

window.BastyonCalls = BastyonCalls
export default BastyonCalls