package de.jluger.webrtcsignalingsample;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.eclipse.jetty.websocket.api.Session;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketClose;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketConnect;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketMessage;
import org.eclipse.jetty.websocket.api.annotations.WebSocket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.gson.Gson;

/**
 * Implements the websocket handler that will broker between the two WebRTC
 * instances.
 * 
 * @author J&ouml;rg Luger
 *
 */
@WebSocket
public class SignalWebsocket {
	private static final Logger LOG = LoggerFactory.getLogger(SignalWebsocket.class);
	private static final ConcurrentHashMap<String, StreamSession> streamSessionMap = new ConcurrentHashMap<>();
	private Gson gson = new Gson();

	/**
	 * Called when a clients connects.
	 * 
	 * @param session The session of the client.
	 */
	@OnWebSocketConnect
	public void connected(Session session) {
		LOG.debug("connected");
	}

	/**
	 * Called when a clients disconnects. Removes any {@link StreamSession} the
	 * client participates in.
	 * 
	 * @param session The session of the client.
	 */
	@OnWebSocketClose
	public void closed(Session session, int statusCode, String reason) {
		LOG.debug("closed");
		List<StreamSession> deleteSessionList = streamSessionMap.values().stream()
				.filter(room -> room.getStreamer().equals(session) || room.getReceiver().equals(session))
				.collect(Collectors.toList());
		deleteSessionList.forEach(streamSession -> streamSessionMap.remove(streamSession.getKey()));
	}

	/**
	 * This methods handles the message brokering between {@link StreamSession}
	 * participaters.
	 * 
	 * @param session The session of the sender.
	 * @param message The message beeing sent.
	 * @throws IOException Thrown when there is an error while sending a message to
	 *                     another client.
	 */
	@OnWebSocketMessage
	public void message(Session session, String message) throws IOException {
		SignalMessage signalMessage = gson.fromJson(message, SignalMessage.class);
		if ("CreateRoom".equals(signalMessage.getOperation())) {
			createRoom(session);
		}
		if ("JoinRoom".equals(signalMessage.getOperation())) {
			joinRoom(session, signalMessage.getPayload());
		}
		if ("StreamerOffer".equals(signalMessage.getOperation())) {
			processStreamData(session, signalMessage.getPayload(), "StreamerOffer", StreamSession::getReceiver);
		}
		if ("ReceiverAnswer".equals(signalMessage.getOperation())) {
			processStreamData(session, signalMessage.getPayload(), "ReceiverAnswer", StreamSession::getStreamer);
		}
		if ("StreamerIceData".equals(signalMessage.getOperation())) {
			processStreamData(session, signalMessage.getPayload(), "StreamerIceData", StreamSession::getReceiver);
		}
		if ("ReceiverIceData".equals(signalMessage.getOperation())) {
			processStreamData(session, signalMessage.getPayload(), "ReceiverIceData", StreamSession::getStreamer);
		}
	}

	/**
	 * Handle the create room message of a streaming client (Has a camera and
	 * wants to send the camera data to another client).
	 * 
	 * @param session The session of the sender.
	 * @throws IOException Thrown when there is an error while sending a message to
	 *                     another client.
	 */
	private void createRoom(Session session) throws IOException {
		int randomInt = new SecureRandom().nextInt();
		if (randomInt < 0) {
			randomInt *= -1;
		}
		String key = Integer.toString(randomInt);
		if (key.length() > 4) {
			key = key.substring(0, 4);
		}
		streamSessionMap.put(key, new StreamSession(key, session));
		String response = gson.toJson(new SignalMessage("CreatedRoom", key));
		session.getRemote().sendString(response);
	}

	/**
	 * Handles the joining of a client to a streaming session. This client wants to
	 * receive video data.
	 * 
	 * @param session      The session of the receiver.
	 * @param receiverJson JSON that deserializes to {@link ReceiverJoinData}.
	 * @throws IOException Thrown when there is an error while sending a message to
	 *                     another client.
	 */
	private void joinRoom(Session session, String receiverJson) throws IOException {
		ReceiverJoinData joinData = gson.fromJson(receiverJson, ReceiverJoinData.class);
		String key = joinData.getKey();
		ensureKeyValid(session, key, () -> {
			String response = gson.toJson(new SignalMessage("JoinedRoom", joinData.getUsername()));
			StreamSession streamSession = streamSessionMap.get(key);
			streamSession.setReceiver(session);
			streamSession.getStreamer().getRemote().sendString(response);
		});
	}

	/**
	 * Ensures that the stream session key is valid or else sends back an error
	 * message to the connecting client.
	 * 
	 * @param session  The session of the sender.
	 * @param key      The key to validate.
	 * @param callable The code to call when the key is valid.
	 * @throws IOException Thrown when there is an error while sending a message to
	 *                     another client.
	 */
	private void ensureKeyValid(Session session, String key, IoCallable callable) throws IOException {
		if (!streamSessionMap.containsKey(key)) {
			String response = gson.toJson(new SignalMessage("Error", "Session " + key + " doesn't exist."));
			session.getRemote().sendString(response);
			return;
		}
		callable.call();
	}

	/**
	 * Takes some json data from the connecting client and sends it to the other
	 * partner in the {@link StreamSession}.
	 * 
	 * @param session         The session of the sender.
	 * @param sessionDataJson The serialized SessionData-Object which contains the data to send.
	 * @param answerOperation The name under which the json data are send to the
	 *                        partner.
	 * @param sessionFunction The function is used to get the other partner out of
	 *                        the {@link StreamSession}.
	 * @throws IOException Thrown when there is an error while sending a message to
	 *                     another client.
	 */
	private void processStreamData(Session session, String sessionDataJson, String answerOperation,
			Function<StreamSession, Session> sessionFunction) throws IOException {
		SessionData sessionData = gson.fromJson(sessionDataJson, SessionData.class);
		String key = sessionData.getKey();
		ensureKeyValid(session, key, () -> {
			String response = gson.toJson(new SignalMessage(answerOperation, sessionData.getData()));
			sessionFunction.apply(streamSessionMap.get(key)).getRemote().sendString(response);
		});
	}

	/**
	 * A functional interface whose function throws an {@link IOException}.
	 */
	@FunctionalInterface
	interface IoCallable {
		void call() throws IOException;
	}

	/**
	 * A {@link StreamSession} consists of a streamer (the one with the camera) and
	 * a receiver (gets the video that the other one takes with his camera). They
	 * share a key so that this server can handle multiple sessions.
	 */
	private static class StreamSession {
		private String key;
		private Session streamer;
		private Session receiver;

		/**
		 * Creates an instance.
		 * 
		 * @param key      The key for this session.
		 * @param streamer The streamer. See class description.
		 */
		public StreamSession(String key, Session streamer) {
			this.key = key;
			this.streamer = streamer;
		}

		public String getKey() {
			return key;
		}

		public Session getStreamer() {
			return streamer;
		}

		public synchronized Session getReceiver() {
			return receiver;
		}

		public synchronized void setReceiver(Session receiver) {
			this.receiver = receiver;
		}
	}

	/**
	 * The data of a client connecting as a receiver of a stream session. Contains
	 * the session key and a user name.
	 */
	private static class ReceiverJoinData {
		private String key;
		private String username;

		public String getKey() {
			return key;
		}

		public String getUsername() {
			return username;
		}

	}

	/**
	 * A container for stream session data to be send from one participant to the
	 * other. This class models the sender data structure . Thus needing the key to
	 * identify the session. The other partner will just get the data.
	 */
	private static class SessionData {
		private String key;
		private String data;

		public String getKey() {
			return key;
		}

		public String getData() {
			return data;
		}
	}

	/**
	 * The minimal container for a message exchange between a client and the server.
	 */
	private static class SignalMessage {
		private String operation;
		private String payload;

		/**
		 * Creates a new instance.
		 * 
		 * @param operation The operation to perform.
		 * @param payload   The data that is specific to the operation.
		 */
		public SignalMessage(String operation, String payload) {
			this.operation = operation;
			this.payload = payload;
		}

		public String getOperation() {
			return operation;
		}

		public String getPayload() {
			return payload;
		}
	}
}
