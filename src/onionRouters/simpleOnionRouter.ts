import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import { generateRsaKeyPair, exportPubKey, exportPrvKey, rsaDecrypt, symDecrypt } from '../crypto';

export async function simpleOnionRouter(nodeId: number) {
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  // Store the node state directly in the function
  const nodeState = {
    lastReceivedEncryptedMessage: null as string | null,
    lastReceivedDecryptedMessage: null as string | null,
    lastMessageDestination: null as number | null
  }

  const { publicKey, privateKey } = await generateRsaKeyPair();
  const publicKeyBase64 = await exportPubKey(publicKey);
  const privateKeyBase64 = await exportPrvKey(privateKey);

  // Step 1.1 Implement the status route
  onionRouter.get('/status', (req, res) => {
    res.send('live');
  });

  // Step 2.1 Nodes GET routes
  // /getLastReceivedEncryptedMessage route
  onionRouter.get('/getLastReceivedEncryptedMessage', (req, res) => {
    console.log(`Last Received Encrypted Message: ${nodeState.lastReceivedEncryptedMessage}`); // Debugging line
    return res.json({ result: nodeState.lastReceivedEncryptedMessage });
  });
  // /getLastReceivedDecryptedMessage route
  onionRouter.get('/getLastReceivedDecryptedMessage', (req, res) => {
    return res.json({ result:  nodeState.lastReceivedDecryptedMessage });
  });
  // /getLastMessageDestination route
  onionRouter.get('/getLastMessageDestination', (req, res) => {
    return res.json({ result:  nodeState.lastMessageDestination });
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

  // Step 6.2 Nodes' /message route
  onionRouter.post("/message", async (req, res) => {
    try {
      const { message }: { message: string } = req.body;
      if(!message){
        res.status(400).json({error: "Missing message"});
        return ;
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

      const nextUrl = `http://localhost:${nextDestination}/message`;

      const response = await fetch(nextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: nextMessage }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      res.json({ status: "Message decrypt successfully" });

    } catch (error) {
      console.error("Error while decrypting the message:", error);
      res.status(500).json({ error: "Internal error while sending the message" });
    }
  });

  // Step 3.2 Create a pair of private and public key
  onionRouter.get("/getPrivateKey", (req, res) => {
    const { nodeId } = req.query;

    if (!nodeId || isNaN(Number(nodeId))) {
      return res.status(400).json({ error: "Invalid nodeId" });
    }

    if (!privateKeyBase64) {
      return res.status(404).json({ error: "Private key not found" });
    }

    return res.status(200).json({ result: privateKeyBase64 });
  });

  // Start the server
  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(
        `Onion router ${nodeId} is listening on port ${
            BASE_ONION_ROUTER_PORT + nodeId
        }`
    );
  });

  return server;
}
