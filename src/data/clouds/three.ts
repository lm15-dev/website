import { LMRouter, Message } from "@lm15/lm15";

const router = new LMRouter();
for (const model of [
  "bedrock-chat:deepseek.v3.2",
  "azure:gpt-4.1-mini",
  "vertex:gemini-2.5-flash",
]) {
  const request = {
    model,
    system:
        "You are the field assistant for a wildlife research " +
        "station. Answer in two sentences.",
    messages: [Message.user(
        "What might be eating the acorns under our oak trees at " +
        "night?",
    )],
  };
  const response = await router.complete(request);
  console.log(`${model}\n${response.text}\n`);
}
