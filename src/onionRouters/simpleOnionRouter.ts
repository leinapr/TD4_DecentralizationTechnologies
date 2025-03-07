import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import { generateRsaKeyPair, exportPubKey, exportPrvKey, rsaDecrypt, symDecrypt } from '../crypto';
import { webcrypto } from "crypto";

declare global {
  var nodeKeys: Record<number, { publicKey: webcrypto.CryptoKey; privateKey: webcrypto.CryptoKey }>;
  var nodeStates: Record<number, {
    lastReceivedEncryptedMessage: string | null;
    lastReceivedDecryptedMessage: string | null;
    lastMessageDestination: number | null;
  }>;
}

export async function simpleOnionRouter(nodeId: number) {
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  if (!globalThis.nodeKeys) {
    globalThis.nodeKeys = {};
  }
  if (!globalThis.nodeKeys[nodeId]) {
    globalThis.nodeKeys[nodeId] = await generateRsaKeyPair();
  }

  if (!globalThis.nodeStates) {
    globalThis.nodeStates = {};
  }
  if (!globalThis.nodeStates[nodeId]) {
    globalThis.nodeStates[nodeId] = {
      lastReceivedEncryptedMessage: null,
      lastReceivedDecryptedMessage: null,
      lastMessageDestination: null,
    };
  }

  const nodeState = globalThis.nodeStates[nodeId];

  const { publicKey, privateKey } = globalThis.nodeKeys[nodeId];
  const publicKeyBase64 = await exportPubKey(publicKey);
  const privateKeyBase64 = await exportPrvKey(privateKey);

  // Step 1.1 Implement the status route
  onionRouter.get('/status', (req, res) => {
    res.send('live');
  });

  // Step 2.1 Nodes GET routes
  // Get last received encrypted message
  onionRouter.get('/getLastReceivedEncryptedMessage', (req, res) => {
    res.json({ result: nodeState.lastReceivedEncryptedMessage });
  });
  // Get last received decrypted message
  onionRouter.get('/getLastReceivedDecryptedMessage', (req, res) => {
    res.json({ result: nodeState.lastReceivedDecryptedMessage });
  });
  // Get last message destination
  onionRouter.get('/getLastMessageDestination', (req, res) => {
    res.json({ result: nodeState.lastMessageDestination });
  });

  // Step 3. Register nodes on the registry
  try {
    const response = await fetch(`http://localhost:${REGISTRY_PORT}/registerNode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodeId,
        pubKey: publicKeyBase64,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register node: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error during the register:", error);
  }

  // Step 3.2 Create a pair of private and public key
  onionRouter.get("/getPrivateKey", (req, res) => {
    res.json({ result: privateKeyBase64 });
  });

  // Step 6.2 Nodes' /message route
  onionRouter.post("/message", async (req, res) => {
    try {
      const { message }: { message: string } = req.body;
      if (!message) {
        res.status(400).json({ error: "Missing message" });
        return;
      }
      // Decrypt the symmetric key
      const encryptedSymKey = message.slice(0, 344);
      const restOfMessage = message.slice(344);
      const symKey = await rsaDecrypt(encryptedSymKey, privateKey);

      // Decrypt the rest of the message
      const decryptedMessage = await symDecrypt(symKey, restOfMessage);
      const nextDestination = parseInt(decryptedMessage.slice(0, 10), 10);
      const nextMessage = decryptedMessage.slice(10);
      console.log(`message: ${message}`)
      console.log(`nextDestination: ${nextDestination}`)
      console.log(`nextMessage: ${nextMessage}`)

      nodeState.lastReceivedEncryptedMessage = message;
      nodeState.lastReceivedDecryptedMessage = nextMessage;
      nodeState.lastMessageDestination = nextDestination;

      // Forward the message to the next node
      const nextUrl = `http://localhost:${nextDestination}/message`;
      const response = await fetch(nextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: nextMessage }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      res.json({ status: "Message decrypted successfully" });

    } catch (error) {
      console.error("Error while decrypting the message:", error);
      res.status(500).json({ error: "Internal error while sending the message" });
    }
  });

  // Start the server
  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(
        `Onion router ${nodeId} is listening on port ${BASE_ONION_ROUTER_PORT + nodeId}`
    );
  });

  return server;
}
