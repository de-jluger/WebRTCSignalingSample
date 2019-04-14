'use strict';

/**
 * This is a minimal example of streaming video data with WebRTC and a signaling server.
 * To keep it simple there will be only one streamer and one receiver. Only the receiver
 * will get a video while the streamer will see nothing (not even a video of himself/herself).
 * 
 * The focus here is more on the communication via server as there are plenty of WebRTC
 * tutorials without signaling server on the internet. One site I like very much is
 * https://webrtc.github.io/samples/
 * 
 * So how does this example work? First you have to establish a connection (RTCPeerConnection)
 * between the two parties. To do this one creates an offer that needs to be transferred to
 * the other party. I've decided that the streamer creates the offer and the receiver is thus
 * the other party.
 * Without websockets the receiver would have to poll the server for the offer but with websockets
 * the server informs the receiver when the offer is available.
 * After the receiver gets the offer he uses it to set the remote description and then creates
 * an answer that is transfered back to the streamer. The streamer uses the answer to set
 * the remote description of his connection object.
 * Another important part of the connection is ICE (Interactive Connectivity Establishment). Both
 * RTCPeerConnection throw icecandidate events. An event handler needs to get the icecandidate and
 * transfer them to the other party so that they add the icecandidate to their candidate list.
 * 
 * Now there is a connection but it won't transfer anything. The streamer needs to add the media
 * tracks (audio, video) to the connection and the receiver must listen on the adding. Only
 * after this there is a chance to display the media data.
 * 
 * This example program provides no mechanism to traverse NAT or go through firewalls. So it probably
 * won't work through the internet or in a corporate environment.
 * To test the program start with two tabs in the same browser on the same machine. If this
 * works work your way up (two browsers same machine, two machines in the same network, ...)
 * until you fail or have your desired setup.
 * 
 * In order to show how to handle multiple connections with one server I've added the concept
 * of rooms. The streamer creates a room and the receiver joins it. The streamer is informed
 * about the joining and starts the streaming manually as I didn't want to test what happens
 * when you stream before someone joins.
 */


/**
 * Handles the entry page where the user decides if he/she wants to be streamer or receiver.
 */
class MainWindow {
	/**
	 * Initializes the page.
	 */
	init() {
		document.getElementById('createRoom').onclick=()=>this.createRoom();
		document.getElementById('joinRoom').onclick=()=>this.joinRoom();
	}
	
	/**
	 * Opens the page for the streamer.
	 */
	createRoom() {
		new StreamVideo().init();
	}
	
	/**
	 * Opens the page for the receiver.
	 */
	joinRoom() {
		let roomKey = document.getElementById('roomKey').value.trim();
		let user = document.getElementById('username').value;
		new ReceiveVideo(roomKey, user).init();
	}
}

/**
 * Base class for streamer and receiver.
 */
class VideoBase {
	
	/**
	 * Loads the page identified by templateId and shows it in the workspace element.
	 */
	initWorkspace(templateId) {
		let template = document.getElementById(templateId).content;
		var clone = document.importNode(template,true);
		let workspace = document.getElementById('workspace')
		workspace.innerHTML='';
		workspace.appendChild(clone);
	}
	
	/**
	 * Creates and returns a websocket to the host of the page. Also adds an error handler.
	 */
	createWebsocket() {
		let webSocket = new WebSocket('ws://'+location.host+'/api/signal');
		webSocket.onerror = (event)=>{
            console.log('onerror::' + JSON.stringify(event, null, 4));
        };
        return webSocket;
	}
	
	/**
	 * Show the Closed page.
	 */
	showClosed() {
		let workspace = document.getElementById('workspace');
		workspace.innerHTML='Closed';
	}
	
    /**
     * Send a message via the websocket. Includes some error handling.
     */
	send(message) {
        if (this.webSocket.readyState == WebSocket.OPEN) {
            this.webSocket.send(message);
        } else {
            console.error('webSocket is not open. readyState=' + this.webSocket.readyState);
        }
    }
}

/**
 * This class implements the logic for the streaming page.
 */
class StreamVideo extends VideoBase {
	constructor() {
		super();
	}
	
	/**
	 * Initializes the page.
	 */
	init() {
		this.initWorkspace('streamerTemplate');
		document.getElementById('startStream').onclick=()=>this.startStreaming();
		document.getElementById('stopStream').onclick=()=>this.stopStreaming();
		this.webSocket = this.createWebsocket();
		this.webSocket.onopen = (event)=>this.initRoom();
        this.webSocket.onclose = (event)=>this.onClose(event);
        this.webSocket.onmessage = (event)=>this.onMessage(event);
	}
	
	/**
	 * Create a room to join for the receiver once the websocket connection is established.
	 */
	initRoom() {
		let createSessionSignal = {operation:'CreateRoom'};
		this.send(JSON.stringify(createSessionSignal));
	}
	
	/**
	 * Called when the websocket is closed. Stops streaming and shows closed page.
	 */
	onClose(event) {
		this.stopStreaming();
		this.showClosed();
	}
	
	/**
	 * Handles the websocket messages send from the server.
	 */
	onMessage(event) {
		let signalResponse = JSON.parse(event.data);
		if (signalResponse.operation==='CreatedRoom') {
			this.createdRoom(signalResponse.payload);
		} else if (signalResponse.operation==='JoinedRoom') {
			this.userJoinded(signalResponse.payload);
		} else if (signalResponse.operation==='ReceiverAnswer') {
			this.receiveAnswer(signalResponse.payload);
		} else if (signalResponse.operation==='ReceiverIceData') {
			this.pc.addIceCandidate(JSON.parse(signalResponse.payload));
		} else {
			console.log(event);
		}
	}
	
	/**
	 * Called when the room was created on the server. Gets the key as argument
	 * and shows it to the user.
	 */
	createdRoom(roomKey) {
		document.getElementById('roomKey').innerHTML='Room key: '+roomKey;
		this.roomKey = roomKey;
	}
	
	/**
	 * Called when the receiver joins the room. Displays the user name.
	 */
	userJoinded(user) {
		let alreadyJoined = document.getElementById('joinded').innerHTML;
		if (alreadyJoined.length>0) {
			alreadyJoined+='<br>';
		}
		alreadyJoined+='User '+user+' joined.';
		document.getElementById('joinded').innerHTML = alreadyJoined;
	}
	
	/**
	 * Called when the user presses the start stream button. Requests access to the webcam
	 * and tries to establish the WebRTC connection.
	 */
	startStreaming() {
		let constraints = {
		        'audio': true,
		        'video': true
		    };
		navigator.mediaDevices.getUserMedia(constraints).then(stream => {
			this.stream = stream;
			this.pc = new RTCPeerConnection();
			this.stream.getTracks().forEach(track => this.pc.addTrack(track, this.stream));
			this.pc.createOffer().then(desc => {
				this.pc.setLocalDescription(desc);
				let descJson = JSON.stringify({key:this.roomKey,data:JSON.stringify(desc)});
				let streamerOffer = {operation:'StreamerOffer',payload:descJson};
				this.send(JSON.stringify(streamerOffer));
			});
			this.pc.addEventListener('icecandidate', e => {
				if (e.candidate) {
					let candidateJson = JSON.stringify({key:this.roomKey,data:JSON.stringify(e.candidate)});
					let streamerIceData = {operation:'StreamerIceData',payload:candidateJson};
					this.send(JSON.stringify(streamerIceData));
				}
			});
	    }).catch(function (error) {
	        console.log(error)
		});
	}
	
	/**
	 * Called when the connection answer from ther receiver is there.
	 * Sets it as remote description on the connection.
	 */
	receiveAnswer(answerJson) {
		this.pc.setRemoteDescription(JSON.parse(answerJson));
	}
	
	/**
	 * Callback for the stop streaming button. Stops the streaming of the media tracks.
	 */
	stopStreaming() {
		this.stream.getTracks().forEach(track => track.stop());
	}
}

/**
 * This class implements the logic for the receiving page.
 */
class ReceiveVideo extends VideoBase {
	/**
	 * Creates a new instance with the room key and the user name from the entry page.
	 */
	constructor(roomKey, user) {
		super();
		this.roomKey = roomKey;
		this.user = user;
		this.chunks = [];
		this.sourceBuffer = null;
		this.queue = [];
	}
	
	/**
	 * Initializes the page.
	 */
	init() {
		this.initWorkspace('receiverTemplate');
		this.webSocket = this.createWebsocket();
		this.webSocket.onopen = (event)=>this.joinRoom();
        this.webSocket.onclose = (event)=>this.onClose(event);
        this.webSocket.onmessage = (event)=>this.onMessage(event);
	}
	
	/**
	 * Called after the websocket is initialized. Joins the room specified by the
	 * roomKey provided in the constructor.
	 */
	joinRoom() {
		let payload = JSON.stringify({key:this.roomKey,username:this.user});
		let initStreamSignal = {operation:'JoinRoom',payload:payload};
		this.send(JSON.stringify(initStreamSignal));
	}
	
	/**
	 * Called when the websocket is closed. Shows the closed page.
	 */
	onClose(event) {
		this.showClosed();
	}
	
	/**
	 * Called when the connection offer from the streamer is received. Creates and inializes
	 * the WebRTC connection.
	 */
	streamOffered(descString) {
		let desc = JSON.parse(descString);
		this.pc = new RTCPeerConnection();
		this.pc.setRemoteDescription(desc);
		this.pc.createAnswer().then(answer => {
			this.pc.setLocalDescription(answer);
			let answerJson = JSON.stringify({key:this.roomKey,data:JSON.stringify(answer)});
			let receiverAnswer = {operation:'ReceiverAnswer',payload:answerJson};
			this.send(JSON.stringify(receiverAnswer));
		});
		this.pc.addEventListener('track', (e) => this.gotRemoteStream(e));
		this.pc.addEventListener('icecandidate', e => {
			if (e.candidate) {
				let candidateJson = JSON.stringify({key:this.roomKey,data:JSON.stringify(e.candidate)});
				let receiverIceData = {operation:'ReceiverIceData',payload:candidateJson};
				this.send(JSON.stringify(receiverIceData));
			}
		});
	}
	
	/**
	 * The event handler for the track listener on the WebRTC connection.
	 * Uses the event data to set the video src.
	 */
	gotRemoteStream(e) {
		let video = document.getElementById('video');
		if (video.srcObject !== e.streams[0]) {
			video.srcObject = e.streams[0];
		}
	}
	
	/**
	 * Handles the websocket messages send from the server.
	 */
	onMessage(event) {
		let signalResponse = JSON.parse(event.data);
		if (signalResponse.operation==='StreamerOffer') {
			this.streamOffered(signalResponse.payload);
		} else if (signalResponse.operation==='StreamerIceData') {
			this.pc.addIceCandidate(JSON.parse(signalResponse.payload));
		} else {
			console.log(event);
		}
	}
}

new MainWindow().init();
