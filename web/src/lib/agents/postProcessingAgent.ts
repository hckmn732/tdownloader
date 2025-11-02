import { webSearchTool, Agent, AgentInputItem, Runner, withTrace } from "@openai/agents";
import { readFileSync } from "node:fs";

// Input type accepted by the runner function
export type WorkflowInput = { input_as_text: string };

// Initialize tools once
const webSearchPreview = webSearchTool({
  userLocation: {
    type: "approximate",
    country: undefined,
    region: undefined,
    city: undefined,
    timezone: undefined
  },
  searchContextSize: "medium"
});

function loadInstructions(): string {
  try {
    // Read co-located instructions file at build/runtime (Node.js runtime)
    return readFileSync(new URL("./postProcessingAgent.instructions.txt", import.meta.url), "utf8");
  } catch {
    throw new Error("Missing instructions file: src/lib/agents/postProcessingAgent.instructions.txt");
  }
}

const myAgent = new Agent({
  name: "My agent",
  instructions: loadInstructions(),
  model: "gpt-4.1",
  tools: [webSearchPreview],
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

export async function runPostProcessingAgent(inputAsText: string): Promise<string> {
  return await withTrace("Download classifiers", async () => {
    const conversationHistory: AgentInputItem[] = [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: inputAsText
          }
        ]
      }
    ];

    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_6902b88775cc8190ad9589c5b6c0245005ca115ce7b640eb"
      }
    });

    const result = await runner.run(myAgent, [...conversationHistory]);
    conversationHistory.push(...result.newItems.map((item: { rawItem: any; }) => item.rawItem));

    if (!result.finalOutput) {
      throw new Error("Agent result is undefined");
    }

    return result.finalOutput;
  });
}


