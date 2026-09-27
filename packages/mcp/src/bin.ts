#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  gateFromEnvironment,
  requireApprovalFromEnvironment,
  storeFromEnvironment,
} from "./config.js";
import { serverLogger } from "./logger.js";
import { createMapleServer } from "./server.js";

const gate = gateFromEnvironment(process.env);
const server = createMapleServer({
  store: storeFromEnvironment(process.env),
  requireApproval: requireApprovalFromEnvironment(process.env),
  logger: serverLogger(),
  ...(gate === undefined ? {} : { gate }),
});

await server.connect(new StdioServerTransport());
