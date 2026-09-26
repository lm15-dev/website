import { LMRouter, Message } from "@lm15/lm15";

const router = new LMRouter({
  apiKeys: { vertex: process.env.VERTEX_API_KEY! },
  settings: { vertex: { location: "europe-west4" } },
});
const request = {
  model: "vertex:gemini-2.5-flash",
  system:
      "You are the field assistant for a wildlife research station. " +
      "Answer in two sentences.",
  messages: [Message.user(
      "What might be eating the acorns under our oak trees at night?",
  )],
};
const response = await router.complete(request);
console.log(response.text);
