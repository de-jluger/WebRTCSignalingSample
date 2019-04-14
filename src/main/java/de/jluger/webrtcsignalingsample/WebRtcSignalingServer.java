package de.jluger.webrtcsignalingsample;

import spark.Spark;

/**
 * Starts a server on port 5070 (usable from all ip adress of the computer) and
 * provides a web gui and a server for signaling between two WebRTC clients.<br>
 * <br>
 * For more details see main.js
 *
 * @author J&ouml;rg Luger
 *
 */
public class WebRtcSignalingServer {
	public static void main(String[] args) {
		Spark.port(5070);
		Spark.externalStaticFileLocation("web");
		Spark.webSocket("/api/signal", SignalWebsocket.class);
		Spark.init();
	}
}
