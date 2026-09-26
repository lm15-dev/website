import { LMRouter, Message } from "@lm15/lm15";

const router = new LMRouter();
const request = {
  model: "vertex:gemini-2.5-flash",
  system:
      "You are the field assistant for a wildlife research station. " +
      "Answer in two sentences.",
  messages: [Message.user(
      "What might be eating the acorns under our oak trees at night?",
  )],
};
try {
  console.log((await router.complete(request)).text);
} catch (error) {
  console.log(String(error));
}
