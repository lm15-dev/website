import {
  AzureCliCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { LMRouter, Message } from "@lm15/lm15";

const token = getBearerTokenProvider(
  new AzureCliCredential(),
  "https://ai.azure.com/.default",
);
const router = new LMRouter({
  apiKeys: { azure: token },
});
const request = {
  model: "azure:gpt-4.1-mini",
  system:
      "You are the field assistant for a wildlife research station. " +
      "Answer in two sentences.",
  messages: [Message.user(
      "What might be eating the acorns under our oak trees at night?",
  )],
};
const response = await router.complete(request);
console.log(response.text);
