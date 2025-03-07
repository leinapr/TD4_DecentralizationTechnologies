import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { REGISTRY_PORT } from "../config";

export type Node = {
  nodeId: number;
  pubKey: string;
 };

export type RegisterNodeBody = {
  nodeId: number;
  pubKey: string;
};

export type GetNodeRegistryBody = {
  nodes: Node[];
};

const nodes: Node[] = [];

export function getRegisteredNodes(): Node[] {
  return nodes;
}

export async function launchRegistry() {
  const _registry = express();
  _registry.use(express.json());
  _registry.use(bodyParser.json());

  // Step 1.3 Spin up the registry
  _registry.get("/status", (req, res) => {
    res.send("live");
  });

  // Step 3.1 Allow nodes to register themselves
  _registry.post("/registerNode", (req, res) => {
    const { nodeId, pubKey }: RegisterNodeBody = req.body;

    if (nodeId === undefined || !pubKey) {
      return res.status(400).json({ error: "Missing nodeId or pubKey" });
    }

    if (nodes.some(node => node.nodeId === nodeId)) {
      return res.status(409).json({ error: "Node already registered" });
    }

    nodes.push({ nodeId, pubKey });
    console.log(`Node ${nodeId} registered.`);
    return res.json({ success: true });
  });

  // Step 3.4 Allow users to retrieve the registry
  _registry.get("/getNodeRegistry", (req, res) => {
    res.json({ nodes: nodes });
  });

  // Start the server
  const server = _registry.listen(REGISTRY_PORT, () => {
    console.log(`Registry is listening on port ${REGISTRY_PORT}`);
  });

  return server;
}
