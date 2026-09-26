/**
 * "Use a cloud provider", "Use AWS" and "Use Microsoft Azure" show files from
 * src/data/<page>/ (one per language) and what scripts/capture-cloud.py (and,
 * for the EC2 steps, scripts/capture-aws-ec2.sh) recorded when it ran them
 * against real cloud accounts. Each recording must be of the file as it is
 * now, and must show what the prose says it shows.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import aws from '../src/data/aws-captures.json' with { type: 'json' };
import azure from '../src/data/azure-captures.json' with { type: 'json' };
import clouds from '../src/data/clouds-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };
import { WIDTH } from '../src/data/tour-examples.ts';

const EXT = { python: 'py', typescript: 'ts', rust: 'rs', go: 'go' } as const;
type Language = keyof typeof EXT;
type Run = { code: string; output: string; error?: string; model?: string };
type Step = { file: string; where?: string } & Partial<Record<Language, Run>>;
type Captures = { date: string; steps: Record<string, Step> };
const PAGES: Record<string, { captures: Captures; mdx: string }> = {
  aws: { captures: aws as Captures, mdx: 'aws.mdx' },
  azure: { captures: azure as Captures, mdx: 'azure.mdx' },
  clouds: { captures: clouds as Captures, mdx: 'cloud.mdx' },
};
const dir = (page: string) => join(import.meta.dirname, '../src/data', page);
const page = (name: string) => readFileSync(join(import.meta.dirname, '../src/content/docs/docs', name), 'utf8');
const LANGUAGES = Object.keys(EXT) as Language[];
const step = (p: string, name: string) => {
  const found = PAGES[p]!.captures.steps[name];
  assert.ok(found, `${p}: no recorded step ${name}`);
  return found;
};
const each = (p: string, name: string, check: (run: Run, language: Language) => void, languages = LANGUAGES) => {
  for (const language of languages) check(step(p, name)[language]!, language);
};

test('every recording is of the example as it is now', () => {
  for (const [name, { captures }] of Object.entries(PAGES)) {
    for (const [id, recorded] of Object.entries(captures.steps)) {
      for (const language of LANGUAGES) {
        const file = join(dir(name), `${recorded.file}.${EXT[language]}`);
        if (!existsSync(file)) {
          assert.equal(recorded[language], undefined, `${name}/${id}/${language}: recorded, but ${file} is gone`);
          continue;
        }
        assert.equal(recorded[language]?.code, readFileSync(file, 'utf8'), `${name}/${id}/${language}: re-run the capture script`);
      }
    }
    const files = new Set(Object.values(captures.steps).map(s => s.file));
    for (const file of readdirSync(dir(name))) assert.ok(files.has(file.replace(/\.\w+$/, '')), `${name}/${file} was never run`);
  }
});

test('every example a page shows was recorded, and fits its code box', () => {
  for (const [name, { mdx }] of Object.entries(PAGES)) {
    for (const [, tag] of page(mdx).matchAll(/<CloudExample ([^>]*)\/>/g)) {
      if (!tag!.includes(`page="${name}"`)) continue;
      const file = /name="(\w+)"/.exec(tag!)![1]!;
      const shown = /step="(\w+)"/.exec(tag!)?.[1] ?? file;
      assert.ok(existsSync(join(dir(name), `${file}.py`)), `${name}: no file ${file}`);
      if (/\boutput\b|code=\{false\}/.test(tag!)) assert.equal(step(name, shown).file, file, `${name}/${shown} is not a run of ${file}`);
    }
    for (const file of readdirSync(dir(name))) {
      for (const line of readFileSync(join(dir(name), file), 'utf8').split('\n')) assert.ok(line.length <= WIDTH, `${name}/${file} (${line.length}): ${line}`);
    }
  }
});

test('the examples ask the station question, with its instructions', () => {
  const flat = (code: string) => code.replace(/["']\s*(?:\+|,)?\s*\n\s*["']/g, '').replace(/\s+/g, ' ');
  for (const [name, { captures }] of Object.entries(PAGES)) {
    for (const [id, recorded] of Object.entries(captures.steps)) {
      if (recorded.file === 'doctor') continue;
      for (const language of LANGUAGES) {
        const run = recorded[language];
        if (!run) continue;
        assert.ok(flat(run.code).includes(TOUR.prompt), `${name}/${id}/${language}: the question`);
        assert.ok(flat(run.code).includes(TOUR.system), `${name}/${id}/${language}: the instructions`);
      }
    }
  }
});

test('Use a cloud provider: one program, three clouds, three answers', () => {
  each('clouds', 'three', (run, language) => {
    assert.ok(!run.error, language);
    const blocks = run.output.trim().split(/\n\s*\n/);
    assert.deepEqual(blocks.map(b => b.split('\n')[0]), ['bedrock-chat:deepseek.v3.2', 'azure:gpt-4.1-mini', 'vertex:gemini-2.5-flash'], language);
    for (const block of blocks) assert.ok(block.split('\n').slice(1).join(' ').trim().length > 40, `${language}: an answer`);
  });
});

test('Use AWS: the recordings show what the page says they show', () => {
  for (const [name, model] of [['ask', 'bedrock-chat:deepseek.v3.2'], ['region', 'bedrock-chat:deepseek.v3.2'],
    ['bearer', 'bedrock-chat:deepseek.v3.2'], ['platform_ec2', 'bedrock-chat:deepseek.v3.2'],
    ['gpt_oss', 'bedrock-chat:openai.gpt-oss-120b-1:0'], ['gpt_oss_mantle', 'bedrock-mantle-chat:openai.gpt-oss-120b']] as const) {
    each('aws', name, (run, language) => {
      assert.ok(run.output.trim() && !run.error, `${name}/${language}: an answer`);
      assert.equal(run.model, model, `${name}/${language}`);
    });
  }
  assert.match(step('aws', 'platform_ec2').where ?? '', /EC2 instance .* instance role/);
  each('aws', 'doctor', (run, language) => {
    assert.match(run.output, /=> ~\/\.aws\/credentials: profile "?'?default/, language);
    assert.match(run.output, /~ EC2 instance metadata \(IMDSv2\)/, language);
    assert.match(run.output, /setting region: us-east-1 \(from the active AWS profile\)/, language);
    assert.match(run.output, /https:\/\/bedrock-runtime\.us-east-1\.amazonaws\.com\/openai\/v1/, language);
  });
  each('aws', 'wrong_region', (run, language) => assert.match(run.error ?? '', /The provided model identifier is invalid/, language));
  each('aws', 'gpt_oss', (run, language) => assert.match(run.output, /^<reasoning>[\s\S]+<\/reasoning>\S/, language));
  each('aws', 'gpt_oss_mantle', (run, language) => assert.doesNotMatch(run.output, /reasoning>/, language));
  each('aws', 'claude', (run, language) => {
    assert.match(run.output, /^(AuthError: )?anthropic\.claude-opus-4-7 is not available for this account/, language);
    assert.match(run.output, /HTTP 403/, language);
    assert.match(run.output, /credential came from: ~\/\.aws\/credentials/i, language);
    if (language !== 'rust') assert.match(run.output, /To fix:[\s\S]*- Verify your bedrock-anthropic account\/project has access\s*$/, language);
  });
  each('aws', 'platform', (run, language) => assert.match(run.error ?? '', /named credential \\?"platform\\?"[\s\S]*answered nothing/, language));
  each('aws', 'platform_ec2_no_region', (run, language) => assert.match(run.error ?? '', /region\\?"?'? is required and has no default; set AWS_REGION/, language));
});

test('Use Microsoft Azure: the recordings show what the page says they show', () => {
  for (const name of ['ask', 'key', 'environment']) {
    each('azure', name, (run, language) => {
      assert.ok(run.output.trim() && !run.error, `${name}/${language}: an answer`);
      assert.equal(run.model, 'azure:gpt-4.1-mini', `${name}/${language}`);
    });
  }
  each('azure', 'identity', (run, language) => assert.ok(run.output.trim() && !run.error, `identity/${language}`), ['python', 'typescript', 'go']);
  assert.equal(step('azure', 'identity').rust, undefined);
  each('azure', 'doctor', (run, language) => {
    assert.equal(run.output.match(/^\s+\? /gm)?.length, 2, `${language}: two places the doctor can't decide`);
    assert.match(run.output, /\? Azure managed identity[\s\S]*\? az account get-access-token/, language);
    assert.match(run.output, /setting scope: https:\/\/ai\.azure\.com\/\.default/, language);
    assert.match(run.output, /openai\/v1 \((from )?env \$AZURE_OPENAI_ENDPOINT\)/, language);
  });
  each('azure', 'doctor_key', (run, language) => {
    assert.match(run.output, /=> env \$AZURE_OPENAI_API_KEY/, language);
    assert.match(run.output, /~ Azure managed identity[\s\S]*~ az account get-access-token/, language);
  });
  each('azure', 'wrong_deployment', (run, language) => {
    assert.match(run.error ?? '', /UnsupportedModelError|DeploymentNotFound|^panic: The API deployment/, language);
    assert.match(run.error ?? '', /The API deployment for this resource does not exist\. If you created the deployment within the last 5 minutes/, language);
  });
  each('azure', 'platform', (run, language) => assert.match(run.error ?? '', /named credential \\?"platform\\?" — Azure managed identity — answered nothing/, language));
});

test('no recording carries a key, a token, an account number or a real home folder', () => {
  const all = JSON.stringify([aws, azure, clouds]);
  assert.doesNotMatch(all, /AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|bedrock-api-key-[A-Za-z0-9+/=]{20,}|ya29\.[A-Za-z0-9_.-]{20,}|eyJ[A-Za-z0-9_-]{20,}/);
  // GUIDs appear only as the ID of a request, never as a tenant, a subscription or a client
  for (const found of all.matchAll(/(.{0,24})[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
    assert.match(found[1]!, /(request |request_id: Some\(\\")$/, `a GUID that is not a request ID: ${found[0]}`);
  }
  assert.doesNotMatch(all, /(?<![\d.])\d{12}(?![\d.])/, 'no AWS account number');
  assert.doesNotMatch(all, /\/home\/|\/Users\//);
});
