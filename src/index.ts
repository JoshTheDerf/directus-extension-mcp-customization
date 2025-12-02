import type { Request, Response, NextFunction } from "express";

import { defineHook } from "@directus/extensions-sdk";
import { HookExtensionContext } from "@directus/types";

// Extends Response to store the original json method before we override it
type ExtendedResponse = Response & {
  _overridden_json?: (this: Response, payload: any, ...args: any[]) => Response;
};

type ExpressContext = {
  req: Request;
  res: ExtendedResponse;
  next: NextFunction;
};

// Hooks into the /mcp route to allow other extensions to add custom MCP tools
// via the event emitter system, extending Directus's built-in MCP functionality
export default defineHook(({ init }, context) => {
  init("routes.before", ({ app }) => {
    app.use(
      "/mcp",
      async (req: Request, res: ExtendedResponse, next: NextFunction) => {
        const expressContext: ExpressContext = { req, res, next };
        switch (req.body.method) {
          case "tools/list":
            return await handleList(expressContext, context);
          case "tools/call":
            return await handleCall(expressContext, context);
          default:
            return next();
        }
      }
    );
  });
});

// Intercepts the tools/list response to allow other extensions to inject their own tools
// by listening to the "mcp.tools.list" filter event
async function handleList(
  { res, next }: ExpressContext,
  context: HookExtensionContext
) {
  const { emitter, logger } = context;
  // Override res.json to modify the response before it's sent
  res._overridden_json = res.json.bind(res);
  res.json = async function (
    this: Response,
    payload: any,
    ...args: any[]
  ): Promise<Response> {
    const duplicatedPayload = JSON.parse(JSON.stringify(payload));
    const builtinTools = duplicatedPayload.result.tools;

    // Emit filter event allowing other extensions to add their tools
    const tools = await emitter.emitFilter(
      "mcp.tools.list",
      builtinTools,
      {},
      context
    );
    duplicatedPayload.result.tools = tools;
    logger.info(`MCP customization: Tools list now has ${tools.length} tools`);

    return res._overridden_json!(duplicatedPayload, ...args);
  };

  next();
}

// Delegates tool execution to other extensions via the event emitter system
// Tries specific tool name first, then falls back to generic handler
// If no custom handler responds, passes control to built-in Directus MCP handlers
async function handleCall(
  { req, res, next }: ExpressContext,
  context: HookExtensionContext
) {
  try {
    const id = req.body.id;
    const toolCall = req.body.params;
    const { emitter } = context;

    // Extract accountability from request and pass via meta
    const meta = {
      accountability: (req as any).accountability,
    };

    let result = undefined;
    // First try tool-specific handler
    result = await emitter.emitFilter(`${toolCall.name}.mcp.tools.call`, toolCall, meta, context);

    // Fall back to generic handler if no specific handler responded
    if (result === undefined || result === toolCall) {
      result = await emitter.emitFilter("mcp.tools.call", toolCall, meta, context);
    }

    // If no custom handler provided a result, let built-in handlers take over
    if (result === undefined || result === toolCall) {
      return next();
    }

    const response = {
      jsonrpc: "2.0",
      id,
      result,
    };

    res.json(response);
  } catch (e) {
    context.logger.error("MCP customization: Error in handleCall:", e);
    return next();
  }
}
