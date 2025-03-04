import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { REGISTRY_PORT } from "../config";
import { generateRsaKeyPair, exportPubKey, exportPrvKey } from "../crypto";

export type Node = { nodeId: number; pubKey: string; privateKey?: string; };

export type RegisterNodeBody = {
  nodeId: number;
  pubKey: string;
  privateKey: string;
};

export type GetNodeRegistryBody = {
  nodes: Node[];
};

let nodes: Node[] = [];

export function getRegisteredNodes(): Node[] {
  return nodes;
}

export async function launchRegistry() {
  const _registry = express();
  _registry.use(express.json());
  _registry.use(bodyParser.json());


  // Health check route
  _registry.get("/status", (req, res) => {
    res.send("live");
  });

  // Route to register a node
  _registry.post("/registerNode", (req, res) => {
    const { nodeId, pubKey, privateKey } = req.body;

    if (!nodeId || !pubKey || !privateKey) {
      res.status(400).json({ error: "Missing nodeId, pubKey, or privateKey" });
    }

    // Check if node is already registered
    if (nodes.some(node => node.nodeId === nodeId)) {
      res.status(409).json({ error: "Node already registered" });
    }

    nodes.push({ nodeId, pubKey, privateKey });
    console.log(`Node ${nodeId} registered.`);
    res.json({ success: true });
  });

  // Route to get the list of registered nodes
  _registry.get("/getNodeRegistry", (req, res) => {
    res.json({ nodes });
  });

  // Get the private key for a specific node (for testing)
  _registry.get("/getPrivateKey", (req: Request, res: Response) => {
    const { nodeId } = req.query;

    if (!nodeId || isNaN(Number(nodeId))) {
      return res.status(400).json({ error: "Invalid nodeId" });
    }

    const nodeIdNum = Number(nodeId);
    const node = nodes.find((node) => node.nodeId === nodeIdNum);

    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    if (!node.privateKey) {
      return res.status(404).json({ error: "Private key not found for this node" });
    }

    else {
      return res.status(200).json({ result: node.privateKey });
    }
  });

  // Get the list of registered nodes
  _registry.get("/getNodeRegistry", (req: Request, res: Response) => {
    console.log("Registered nodes:", nodes);
    if (nodes.length === 0) {
      return res.status(404).json({ error: "No nodes registered" });
    }
    return res.status(200).json({ nodes });
  });

  // Start the server
  const server = _registry.listen(REGISTRY_PORT, () => {
    console.log(`Registry is listening on port ${REGISTRY_PORT}`);
  });

  return server;
}
