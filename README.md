# Directus MCP Customization Extension

This extension enables other Directus extensions to add custom MCP (Model Context Protocol) tools by hooking into Directus's event emitter system.

## Purpose

Directus has built-in MCP support, but it only exposes its own internal tools. This extension intercepts the `/mcp` endpoint to allow other extensions to:

1. Add their own tools to the MCP tools list
2. Handle execution of those custom tools

## Usage with Other Extensions

To add custom MCP tools from another extension, use Directus's **isolated event emitter system**.

> **Important:** For security reasons, the MCP feature uses an isolated event emitter, separate from the core Directus event system. You **must** use `emitter.onFilter()` directly instead of the `filter()` callback from `defineHook`.

### 1. Adding Tools to the List

Listen to the `mcp.tools.list` filter event to inject your tools:

```typescript
import { defineHook } from "@directus/extensions-sdk";

export default defineHook((_, { emitter }) => {
  emitter.onFilter("mcp.tools.list", (tools) => {
    // Add your custom tool to the array
    return [
      ...tools,
      {
        name: "my_custom_tool",
        description: "Does something useful",
        inputSchema: {
          type: "object",
          properties: {
            param1: { type: "string" }
          },
          required: ["param1"]
        }
      }
    ];
  });
});
```

### 2. Handling Tool Execution

Listen to a tool-specific filter event to handle your tool's execution:

```typescript
import { defineHook } from "@directus/extensions-sdk";

export default defineHook((_, { emitter, services, getSchema }) => {
  emitter.onFilter("my_custom_tool.mcp.tools.call", async (toolCall, meta) => {
    // Access user accountability from meta parameter
    const { accountability } = meta;

    // Get schema and create service with accountability
    const schema = await getSchema();
    const { ItemsService } = services;

    const itemsService = new ItemsService("my_collection", {
      schema,
      accountability, // Pass accountability for permission checks
    });

    // Execute your tool logic with proper permissions
    const result = await itemsService.readByQuery({
      filter: { status: { _eq: toolCall.arguments.status } }
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
        }
      ]
    };
  });
});
```

**Important:** The filter event signature is:
```typescript
async (toolCall, meta, context) => { ... }
```

- `toolCall` - Contains `name` and `arguments` from the MCP request
- `meta` - Contains `accountability` extracted from the Express request
- `context` - Full hook extension context (services, getSchema, etc.)

The `accountability` object contains the user's authentication and authorization context, allowing Directus services to enforce proper permissions.

Alternatively, use the generic `mcp.tools.call` event and check the tool name:

```typescript
emitter.onFilter("mcp.tools.call", async (toolCall, meta) => {
  if (toolCall.name === "my_custom_tool") {
    // Handle your specific tool with accountability
    const { accountability } = meta;
    return { content: [{ type: "text", text: "Result" }] };
  }
});
```

### Complete Example

Here's a complete example showing both adding a tool and handling its execution:

```typescript
import { defineHook } from "@directus/extensions-sdk";

export default defineHook((_, { logger, emitter, services, getSchema }) => {
  // Add tool to the list
  emitter.onFilter("mcp.tools.list", (tools) => {
    return [
      ...tools,
      {
        name: "my_custom_tool",
        description: "Does something useful",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string", description: "Input parameter" }
          },
          required: ["input"]
        }
      }
    ];
  });

  // Handle tool execution with accountability
  emitter.onFilter("my_custom_tool.mcp.tools.call", async (toolCall, meta) => {
    const { input } = toolCall.arguments;
    const { accountability } = meta;

    // Use accountability for any service that needs permissions
    const schema = await getSchema();
    const { ItemsService } = services;

    const itemsService = new ItemsService("my_collection", {
      schema,
      accountability,
    });

    return {
      content: [
        {
          type: "text",
          text: `Processed: ${input}`
        }
      ]
    };
  });
});
```

## How It Works

1. The extension hooks into `routes.before` to intercept the `/mcp` endpoint
2. For `tools/list` requests, it overrides the response to emit the `mcp.tools.list` filter
3. For `tools/call` requests, it:
   - Extracts `accountability` from the Express request (`req.accountability`)
   - Creates a `meta` object containing the accountability
   - Emits tool-specific filter event: `{toolName}.mcp.tools.call` with (toolCall, meta, context)
   - Falls back to generic `mcp.tools.call` if no specific handler responds
   - Passes control to built-in Directus handlers via `next()` if no custom handler responds
4. Other extensions register filter listeners to add tools and handle calls

### Accountability Flow

```
MCP Request → Express Middleware (adds req.accountability)
     ↓
Customization Extension (extracts req.accountability)
     ↓
Filter Event Emitted with meta = { accountability }
     ↓
Custom Tool Handler (receives accountability via meta parameter)
     ↓
Directus Service (uses accountability for permission checks)
```

The accountability object is critical for:
- User authentication and authorization
- Permission enforcement in Directus services
- Audit logging and activity tracking
- Multi-tenant data isolation

## Installation

This extension must be installed before any other extensions that want to add custom MCP tools.

```bash
npm install
npm run build
```

Then restart your Directus instance.
