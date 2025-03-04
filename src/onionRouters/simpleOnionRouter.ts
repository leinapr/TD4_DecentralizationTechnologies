import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import { generateRsaKeyPair, exportPubKey, exportPrvKey } from '../crypto';

export async function simpleOnionRouter(nodeId: number) {
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  let lastReceivedEncryptedMessage: string | null = null;
  let lastReceivedDecryptedMessage: string | null = null;
  let lastMessageDestination: number | null = null;

  const { publicKey, privateKey } = await generateRsaKeyPair();
  const pubKey = await exportPubKey(publicKey);
  const prvKey = await exportPrvKey(privateKey);

  // TODO implement the status route
  // Step 1
  onionRouter.get('/status', (req, res) => {
    res.send('live');
  });

  // Step 2. Define simple GET routes
  // /getLastReceivedEncryptedMessage route
  onionRouter.get('/getLastReceivedEncryptedMessage', (req, res) => {
    console.log(`Last Received Encrypted Message: ${lastReceivedEncryptedMessage}`); // Debugging line
    res.json({ result: lastReceivedEncryptedMessage });
  });
  // /getLastReceivedDecryptedMessage route
  onionRouter.get('/getLastReceivedDecryptedMessage', (req, res) => {
    res.json({ result: lastReceivedDecryptedMessage });
  });
  // /getLastMessageDestination route
  onionRouter.get('/getLastMessageDestination', (req, res) => {
    res.json({ result: lastMessageDestination });
  });

  // Step 3. Register nodes on the registry
  await fetch(`http://localhost:${REGISTRY_PORT}/registerNode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nodeId, pubKey }),
  });

  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(
      `Onion router ${nodeId} is listening on port ${
        BASE_ONION_ROUTER_PORT + nodeId
      }`
    );
  });

  return server;
}
