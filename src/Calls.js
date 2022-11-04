import {EventEmitter} from 'events';
import "./scss/index.sass";
import {logPlugin} from '@babel/preset-env/lib/debug';
class Calls extends EventEmitter {

	constructor(client, matrixcs, root){
		super()
		this.client = client;
		this.matrixcs = matrixcs;
		this.initEvents()
		this.initTemplates(root)
	}

	controls = {}
	isFrontalCamera = false
	videoStreams = null
	isMuted = false
	activeCall = null
	callQueue = []
	isMuted = false

	templates = {
		incomingCall : function(){
			return `
			<div class="bc-incoming-call">
				<div class="user">
					<div class="avatar">
						<img src="https://i.imgur.com/MVRPe5G.jpg" alt="">
					</div>
					<div class="title">
						<div class="name">${this.activeCall.initiator.name}</div>
						<div class="description">Входящий звонок</div>
					</div>
				</div>
				<div class="buttons">
					<button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
					<button class="bc-btn bc-answer" id="bc-answer"><i class="fas fa-phone"></i></button>
				</div>
			</div>
		`
		},
		endedCall : function(reason){
			return `	
			<div class="bc-ended-call">
				<div class="title">Звонок завершен</div>
				${reason ? `<div className="description"></div>` : null}
				<button>ok</button>
			</div>`
		},

		videoCall : function(){
			return `
			<div class="bc-video-container">
				<div class="bc-video active">
					<video id="remote" pip="false" autoplay playsinline ></video>
				
				</div>
				<div class="bc-video minified">
					<video id="local" pip="false" autoplay playsinline ></video>
				</div>
			</div>
			<div class="bc-controls">
				<button class="bc-btn bc-mute" id="bc-mute"><i class="fas fa-microphone"></i></button>
				<button class="bc-btn bc-hide" id="bc-hide"><i class="fas fa-video"></i></button>
				<button class="bc-btn bc-decline" id="bc-decline"><i class="fas fa-phone"></i></button>
				<button class="bc-btn camera" id="bc-camera"><i class="fas fa-sync-alt"></i></button>
				<button class="bc-btn minimize" id="bc-minimize"><i class="fas fa-compress"></i></button>
			</div>
		`
		}

	}

	initTemplates(outerRoot){
		outerRoot.insertAdjacentHTML('beforeend', `<div class="bc-container" id="bc-root"></div>`);
		this.root = document.getElementById('bc-root')
	}


	initEvents(){
		this.client.on("Call.incoming", (call) => {
			let members = this.client.store.rooms[ call.roomId ].currentState.members
			let initiatorId = Object.keys(members).filter(m => m !== this.client.credentials.userId)
			let initiator = members[ initiatorId ]
			let user = members[this.client.credentials.userId]

			call.initiator = initiator
			call.user = user


			this.addCallListeners(call)
			if (!this.activeCall) {
				this.activeCall = call
				this.renderTemplates('incomingCall')
			} else {
				this.callQueue.push(call)
			}

		});


	}

	answer(){
		// try {
		// 	const constraints = { video: { width: 320/*320-640-1280*/ }, audio: true };
		// 	let stream = navigator.mediaDevices.getUserMedia(constraints)
		// 	let tracks = stream.getTracks()
		// 	if (tracks) {
		// 		for (let t = 0; t < tracks.length; t++) tracks[t].stop()
		// 	}
		// } catch (e) {
		// 	console.log('нет доступа к медиа',e)
		// 	return
		// }

		try {
			this.activeCall.answer()
			console.log('answer',this.activeCall)
			this.renderTemplates('videoCall')
		} catch (e) {
			console.log(e)
			return
		}
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
	}

	hide(e){
		e.stopPropagation()
		let sender = this.activeCall.peerConn.getSenders().find((s) => {
			return s.track.kind === 'video';
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

	}

	camera(e) {
		let self = this
		if (e) e.stopPropagation()

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
					console.log('Используется фронтальная камера')
					self.isFrontalCamera = true
				}
				console.log('список видео', video)

				if (video.length > 1) {
					if (!self.isFrontalCamera) {

						target = video.find((device) => {
							return device.label.includes('front') || device.label.includes('передней')
						})
						target ? self.isFrontalCamera = true :  self.isFrontalCamera = false
						console.log('меняем на переднюю')
					} else {
						target = video.reverse().find((device) => {
							return device.label.includes('back') || device.label.includes('задней')
						})
						target ? self.isFrontalCamera = false : self.isFrontalCamera = true
						console.log('меняем на заднюю')
					}
					console.log('change',target)

				} else return

				let videoConstraints = {}
				videoConstraints.deviceId = { exact: target.deviceId }
				videoConstraints.facingMode = 'user'

				const constraints = {
					video: videoConstraints,
					audio: false
				};
				navigator.mediaDevices
				  .getUserMedia(constraints)
				  .then(stream => {
					  console.log('target stream',stream)
					  //
					  // function onactive() {
						//   console.log("on active event");
					  // }
					  //
					  // function oninactive() {
						//   console.log("on inactive event");
					  // }
					  // stream.onactive = onactive;
					  // stream.oninactive = oninactive;

					  stream.getTracks().forEach(function(track) {
						  console.log('track')
						  const sender = self.activeCall.peerConn.getSenders().find((s) => {
							  return s.track.kind == track.kind;
						  })
						  console.log('текущий видеострим ', sender)
						  if (sender.track.label === track.label) {
							  console.log('лдинаковый стрим')
							  return
						  }
						  console.log('новый видео трек ', track)
						  sender.replaceTrack(track);
						  self.videoStreams.local.srcObject = stream
						  console.log(self.videoStreams.local.srcObject)
					  })
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

	minimized() {
			let target = document.getElementById('bc-minimize').children[0]

			if (this.root.classList.contains('minified')) {
				target.classList.add('fa-compress')
				target.classList.remove('fa-expand')
				this.root.classList.remove('minified')
			} else {
				target.classList.remove('fa-compress')
				target.classList.add('fa-expand')
				this.root.classList.add('minified')
			}
	}

	async initCall(roomId){

		try {
			const constraints = {
				video: true,
				audio: true
			};
			let stream = await navigator.mediaDevices.getUserMedia(constraints)

		} catch (e) {
			console.log('нет доступа к медиа',e)
			return
		}



		const call = matrixcs.createNewMatrixCall(this.client, roomId)

		call.placeVideoCall(document.getElementById("remote"),document.getElementById("local"))

		let members = this.client.store.rooms[ call.roomId ].currentState.members
		let initiatorId = Object.keys(members).filter(m => m !== this.client.credentials.userId)
		let initiator = members[ initiatorId ]
		let user = members[this.client.credentials.userId]

		call.initiator = initiator
		call.user = user

		this.addCallListeners(call)

		if (!this.activeCall) {
			this.activeCall = call
		} else {
			this.callQueue.push(call)
		}
		this.renderTemplates('videoCall')


		return call
	}

	hangup(e){
		e.stopPropagation()
		this.activeCall.hangup('ended', false)
		this.renderTemplates()
		console.log('hangup')
	}

	reject(e){
		e.stopPropagation()
		this.activeCall.hangup('занят',false)
		this.renderTemplates()
		console.log('reject')
	}

	changeView(event){

		if(this.root.classList.contains('minified')){
			this.minimized()
			return
		}
		// let target = event.target.parentElement
		// let sub
		// if (event.target.id === 'local') {
		// 	sub = this.videoStreams.remote.parentElement
		// } else {
		// 	sub = this.videoStreams.local.parentElement
		// }
		// if (target.classList.contains('active')) {
		// 	target.classList.remove('active')
		// 	sub.classList.remove('minified')
		// } else if (target.classList.contains('minified')) {
		// 	target.classList.remove('minified')
		// 	sub.classList.remove('active')
		// } else {
		// 	target.classList.add('active')
		// 	sub.classList.add('minified')
		// }


	}

	 initCallInterface(type){

		switch (type) {
			case 'incomingCall':
				document.getElementById("bc-answer").addEventListener('click', this.answer.bind(this))
				document.getElementById("bc-decline").addEventListener('click', this.reject.bind(this))
				break;
			case 'videoCall':
				this.videoStreams = {
					remote : document.getElementById("remote"),
					local : document.getElementById("local")
				}
				try {
					this.activeCall.setLocalVideoElement(this.videoStreams.local)
					this.activeCall.setRemoteVideoElement(this.videoStreams.remote)
					this.addVideoInterfaceListeners()
					console.log('стримы',this.videoStreams)
				} catch (e) {
					console.log('init interface',e)
				}
				break;
		}
	}

	addVideoInterfaceListeners(){
		// this.videoStreams.remote.onplay = function(e){
		// 	console.log('play remote')}
		this.videoStreams.local.addEventListener('click', (e) => this.changeView.call(this, e))
		this.videoStreams.remote.addEventListener('click', (e) => this.changeView.call(this, e))
		document.getElementById("bc-decline").addEventListener('click', (e) => this.hangup.call(this,e))
		document.getElementById("bc-mute").addEventListener('click', (e) => this.mute.call(this,e))
		document.getElementById("bc-hide").addEventListener('click', (e) => this.hide.call(this,e))
		document.getElementById("bc-camera").addEventListener('click', (e) => this.camera.call(this,e))
		document.getElementById("bc-minimize").addEventListener('click', (e) => this.minimized.call(this,e))
		// this.root.addEventListener('click',(e) => this.play.call(this,e))


	}

	addCallListeners(call){
		call.on("hangup", (reason) => {
			console.log('Звонок окончен',reason)
			this.callQueue.filter(i => i.callId !== call.callId)
			if (call.callId === this.activeCall.callId) {
				this.activeCall = null
				this.renderTemplates()

			}
		});
		call.on("onHangupReceived", (reason) => {
			console.log('hangupReceived',reason)
		});
		call.on("error", function(err){
			console.log(err)
			this.lastError = err.message;
			call.hangup('error');
			this.emit('error', err)
		});
	}


	renderTemplates(template){
		this.root.classList.remove('minified')
		if(template === 'videoCall') {
			this.root.classList.add('full')
		} else {
			this.root.classList.remove('full')
		}

		if (template) {
			this.root.classList.add('active')
		} else {
			this.root.classList.remove('active')
		}
		this.root.innerHTML = this.templates[ template ]?.call(this) || ''
		this.initCallInterface(template)
	}

}

export default Calls