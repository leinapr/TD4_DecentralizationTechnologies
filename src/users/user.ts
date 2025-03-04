import bodyParser from "body-parser";
import express from "express";
import crypto from "crypto";
import { BASE_USER_PORT } from "../config";
import { getRegisteredNodes } from "../registry/registry";

export type SendMessageBody = {
  message: string;
  destinationUserId: number;
};

export async function user(userId: number) {
  const _user = express();
  _user.use(express.json());
  _user.use(bodyParser.json());

  let lastReceivedMessage: string | null = null;
  let lastSentMessage: string | null = null;

  // TODO implement the status route
  // Step 1. Setup the project
  // /status route
  _user.get('/status', (req, res) => {
    res.send('live');
  });

  // Step 2. Define simple GET routes
  // /getLastReceivedMessage route
  _user.get('/getLastReceivedMessage', (req, res) => {
    res.json({ result: lastReceivedMessage });
  });

  // /getLastSentMessage route
  _user.get('/getLastSentMessage', (req, res) => {
    res.json({ result: lastSentMessage });
  });

  // Step 4. Sending messages to users
  // /message route to handle incoming messages
  _user.post('/message', (req, res) => {
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
    }

    // Update the last received message
    lastReceivedMessage = message;

    res.status(200).json({ success: true });
  });

  // Step 6. Forwarding messages through the network
  // /sendMessage route to handle outgoing messages
  _user.post('/sendMessage', async (req, res) => {
    const { message, destinationUserId } = req.body;

    if (!message || destinationUserId === undefined) {
      res.status(400).json({ error: 'Message and destinationUserId are required' });
    }

    try {
      // 1. Get 3 distinct nodes from registry
      const nodes = await getRegisteredNodes();
      if (nodes.length < 3) res.status(500).json({ error: "Not enough nodes available" });

      const circuit = nodes.slice(0, 3); // Pick first 3 nodes

      // 2. Generate unique symmetric keys for each node
      const symmetricKeys = circuit.map(() => crypto.randomBytes(32));

      // 3. Encrypt message layer by layer
      let encryptedMessage = Buffer.from(message, "utf8");

      for (let i = circuit.length - 1; i >= 0; i--) {
        const { nodeId, pubKey } = circuit[i];

        // Encode destination as a 10-character string
        const nextDestination = i === circuit.length - 1
            ? destinationUserId
            : circuit[i + 1].nodeId;
        const destinationStr = nextDestination.toString().padStart(10, "0");

        // Encrypt (previous ciphertext + destination)
        const combinedData = Buffer.concat([Buffer.from(destinationStr), encryptedMessage]);
        encryptedMessage = encryptWithSymmetricKey(combinedData, symmetricKeys[i]);

        // Encrypt the symmetric key with the node's public RSA key
        const encryptedSymmetricKey = encryptWithRSA(symmetricKeys[i], pubKey);

        // Final message format: [Encrypted Symmetric Key] + [Encrypted Data]
        encryptedMessage = Buffer.concat([encryptedSymmetricKey, encryptedMessage]);
      }

      // 4. Send encrypted message to first node
      const entryNode = circuit[0];
      const response = await fetch(`http://localhost:${BASE_USER_PORT + entryNode.nodeId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: encryptedMessage.toString("base64") }),
      });

      if (!response.ok) throw new Error(`Failed to send message: ${response.statusText}`);

      lastSentMessage = message;
      res.status(200).json({ success: true });

    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: "Failed to send message", details: err.message });
    }
  });

  // Encrypt data with AES-256-GCM
  function encryptWithSymmetricKey(data: Buffer, key: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encryptedData = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([iv, encryptedData, cipher.getAuthTag()]);
  }

  // Encrypt symmetric key with RSA
  function encryptWithRSA(data: Buffer, publicKey: string): Buffer {
    return crypto.publicEncrypt(publicKey, data);
  }

  const server = _user.listen(BASE_USER_PORT + userId, () => {
    console.log(
      `User ${userId} is listening on port ${BASE_USER_PORT + userId}`
    );
  });

  return server;
}
