/** The JavaScript runtime: this page's own `lm15/browser`, no loading step. */

import { ResponseStream, stringifyJson, utf8Decode, type Request, type Response } from "lm15/browser";
import { createClient, streams, type Connection, type Wire } from "../experience.ts";
import { isJudgeRequest } from "../judge.ts";
import type { Runtime } from "./index.ts";

export const javascriptRuntime: Runtime = {
  id: "javascript",
  label: "JavaScript",
  claim: "lm15/browser, the TypeScript SDK's web entry, running in this page.",
  loaded: () => true,
  async load() {},
  async wire(connection, key, request): Promise<Wire> {
    const built = await createClient(connection, key).buildRequest(request, streams(connection) && !isJudgeRequest(request));
    return { method: built.method, url: built.url, headers: built.headers.map(([k, v]) => [k, v]), body: utf8Decode(built.body) };
  },
  async stream(connection, key, request, signal, onText): Promise<Response> {
    const lm = createClient(connection, key);
    if (!streams(connection)) {
      // One piece: the answer lands whole.
      const response = await lm.complete(request, { signal });
      onText(response.text ?? (response.data !== undefined ? stringifyJson(response.data, { indent: 2 }) : ""));
      return response;
    }
    const result = new ResponseStream(lm.stream(request, { signal }), request);
    for await (const text of result) onText(text);
    return result.response();
  },
  judge(connection, key, request, signal): Promise<Response> {
    return createClient(connection, key).complete(request, { signal });
  },
};
