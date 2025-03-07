import bodyParser from "body-parser";
import express from "express";
import { createRandomSymmetricKey, exportSymKey, symEncrypt, rsaEncrypt } from "../crypto";
import { BASE_ONION_ROUTER_PORT, BASE_USER_PORT } from "../config";
import { getRegisteredNodes } from "../registry/registry";

export async function user(userId: number) {
  const _user = express();
  _user.use(express.json());
  _user.use(bodyParser.json());

  const userState = {
    lastReceivedMessage: null as string | null,
    lastSentMessage: null as string |  null,
    lastCircuit: [] as number[],
    lastMessageDestination: null as number | null
  }

  // Step 1.2 Spin up users
  _user.get('/status', (req, res) => {
    res.send('live');
  });

  // Step 2.2 Users GET routes
  // /getLastReceivedMessage route
  _user.get('/getLastReceivedMessage', (req, res) => {
    res.json({ result: userState.lastReceivedMessage });
  });

  // /getLastSentMessage route
  _user.get('/getLastSentMessage', (req, res) => {
    res.json({ result: userState.lastSentMessage });
  });

  // /getLastCircuit route
  _user.get('/getLastCircuit', (req, res) => {
    res.json({ result: userState.lastCircuit });
  });

  // Step 4. Sending messages to users
  // /message route to handle incoming messages
  _user.post('/message', (req, res) => {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    userState.lastReceivedMessage = message;
    console.log(`[User ${userId}] Received message:`, message);
    return res.json({ success: true });
  });

  // Step 6.1 Users /sendMessage route
  _user.post('/sendMessage', async (req, res) => {
    const { message, destinationUserId } = req.body;

    if (!message || destinationUserId === undefined) {
      return res.status(400).json({ error: 'Message and destinationUserId are required' });
    }

    try {
      // Get 3 distinct nodes from registry
      const nodes = await getRegisteredNodes();
      if (nodes.length < 3) {
        return res.status(500).json({ error: "Not enough nodes available" });
      }
      const shuffledNodes = nodes.sort(() => 0.5 - Math.random()).slice(0, 3);
      const circuit = shuffledNodes.map(node => node.nodeId);

      // Generate unique symmetric keys for each node
      const symmetricKeys = await Promise.all(circuit.map(() => createRandomSymmetricKey()));

      // Encrypt message layer by layer (Onion Encryption)
      let encryptedMessage = message;

      for (let i = circuit.length - 1; i >= 0; i--) {
        const nextDestination = (i === circuit.length - 1)
            ? (BASE_USER_PORT + destinationUserId).toString() // Final destination (User)
            : (BASE_ONION_ROUTER_PORT + circuit[i + 1]).toString(); // Next node in the circuit

        const formattedDestination = nextDestination.padStart(10, "0");

        encryptedMessage = await symEncrypt(symmetricKeys[i], formattedDestination + encryptedMessage);
        const base64SymKey = await exportSymKey(symmetricKeys[i]);
        const encryptedSymKey = await rsaEncrypt(base64SymKey, shuffledNodes[i].pubKey);
        encryptedMessage = encryptedSymKey + encryptedMessage;
      }

      // Send encrypted message to first node
      const response = await fetch(`http://localhost:${BASE_ONION_ROUTER_PORT + circuit[0]}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: encryptedMessage })
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      userState.lastSentMessage = message;
      userState.lastCircuit = circuit;
      return res.status(200).json("success");

    } catch (error) {
      return res.status(500).json({ error: "Failed to send message" });
    }
  });

  const server = _user.listen(BASE_USER_PORT + userId, () => {
    console.log(
        `User ${userId} is listening on port ${BASE_USER_PORT + userId}`
    );
  });

  return server;
}