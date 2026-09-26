import { LMRouter, Message } from "@lm15/lm15";

const router = new LMRouter({
  settings: { "bedrock-chat": { region: "us-east-1" } },
});
const request = {
  model: "bedrock-chat:deepseek.v3.2",
  system:
      "You are the field assistant for a wildlife research station. " +
      "Answer in two sentences.",
  messages: [Message.user(
      "What might be eating the acorns under our oak trees at night?",
  )],
};
const response = await router.complete(request);
console.log(response.text);
