"""Small, equivalent non-streaming calls through each SDK's public client API."""
RUST = {
    'async-openai': {
        'label': 'async-openai', 'version': '0.42.0',
        'dependency': 'async-openai = { version = "=0.42.0", features = ["chat-completion"] }',
        'source': 'https://github.com/64bit/async-openai',
        'imports': 'use async_openai::{Client, config::OpenAIConfig, types::chat::{CreateChatCompletionRequestArgs, ChatCompletionRequestUserMessageArgs}};',
        'setup': 'let client = Client::with_config(OpenAIConfig::new().with_api_key("benchmark").with_api_base(format!("{endpoint}/v1")));',
        'call': '''let request = CreateChatCompletionRequestArgs::default().model("gpt-4.1-mini").max_tokens(32u32)
            .messages([ChatCompletionRequestUserMessageArgs::default().content("Say hello.").build()?.into()]).build()?;
        let response = client.chat().create(request).await?;
        response.choices.into_iter().next().ok_or("missing choice")?.message.content.unwrap_or_default()''',
    },
    'genai': {
        'label': 'genai', 'version': '0.6.5', 'dependency': 'genai = "=0.6.5"',
        'source': 'https://github.com/jeremychone/rust-genai',
        'imports': 'use genai::{Client, ModelSpec, ModelIden, ServiceTarget, adapter::AdapterKind, chat::{ChatRequest, ChatMessage}, resolver::{AuthData, Endpoint}};',
        'setup': '''let client = Client::default();
        let model = ModelSpec::Target(ServiceTarget { model: ModelIden::from_static(AdapterKind::OpenAI, "gpt-4.1-mini"), endpoint: Endpoint::from_owned(format!("{endpoint}/v1/")), auth: AuthData::Key("benchmark".into()) });''',
        'call': '''let request = ChatRequest::new(vec![ChatMessage::user("Say hello.")]);
        let response = client.exec_chat(model.clone(), request, Some(&genai::chat::ChatOptions::default().with_max_tokens(32))).await?;
        response.content.into_joined_texts().unwrap_or_default()''',
    },
    'rig': {
        'label': 'Rig', 'version': '0.42.0', 'dependency': 'rig-core = "=0.42.0"',
        'source': 'https://github.com/0xPlaygrounds/rig',
        'imports': 'use rig_core::{client::CompletionClient, completion::{AssistantContent, CompletionModel}, providers::openai};',
        'setup': '''let client = openai::Client::builder().api_key("benchmark").base_url(format!("{endpoint}/v1")).build()?.completions_api();
        let model = client.completion_model("gpt-4.1-mini");''',
        'call': '''let request = model.completion_request("Say hello.").max_tokens(32).build();
        let response = model.completion(request).await?;
        let mut text = String::new();
        for item in response.choice { if let AssistantContent::Text(part) = item { text.push_str(&part.text); } }
        text''',
    },
    'lm15': {
        'label': 'LM15', 'version': '0.5.0',
        'dependency': 'lm15 = { path = "../../sources/rust" }',
        'source': 'https://github.com/lm15-dev/lm15-rs',
        'imports': 'use lm15::{OpenAIChatLM, Request, Message};',
        'setup': 'let client = OpenAIChatLM::builder().api_key("benchmark").base_url(format!("{endpoint}/v1")).build()?;',
        'call': '''let request = Request { model: "gpt-4.1-mini".into(), messages: vec![Message::user("Say hello.")?], config: lm15::Config { max_tokens: Some(32), ..Default::default() }, ..Default::default() };
        let response = client.complete(&request).await?;
        response.text().unwrap_or_default().to_string()''',
    },
}
GO = {
    'openai': {
        'label': 'OpenAI', 'module': 'github.com/openai/openai-go/v3',
        'source': 'https://github.com/openai/openai-go',
        'imports': 'openai "github.com/openai/openai-go/v3"\n"github.com/openai/openai-go/v3/option"',
        'setup': 'client := openai.NewClient(option.WithAPIKey("benchmark"), option.WithBaseURL(endpoint+"/v1"), option.WithMaxRetries(0))',
        'call': '''response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
            Model: "gpt-4.1-mini", MaxTokens: openai.Int(32), Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("Say hello.")},
        })
        if err != nil { return "", err }; if len(response.Choices) != 1 { return "", fmt.Errorf("missing choice") }
        return response.Choices[0].Message.Content, nil''',
    },
    'anthropic': {
        'label': 'Anthropic', 'module': 'github.com/anthropics/anthropic-sdk-go',
        'source': 'https://github.com/anthropics/anthropic-sdk-go',
        'imports': 'anthropic "github.com/anthropics/anthropic-sdk-go"\n"github.com/anthropics/anthropic-sdk-go/option"',
        'setup': 'client := anthropic.NewClient(option.WithAPIKey("benchmark"), option.WithBaseURL(endpoint), option.WithMaxRetries(0))',
        'call': '''response, err := client.Messages.New(ctx, anthropic.MessageNewParams{
            Model: "claude-haiku-4-5", MaxTokens: 32,
            Messages: []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("Say hello."))},
        })
        if err != nil { return "", err }; if len(response.Content) != 1 { return "", fmt.Errorf("missing content") }
        return response.Content[0].Text, nil''',
    },
    'google': {
        'label': 'Google GenAI', 'module': 'google.golang.org/genai',
        'source': 'https://github.com/googleapis/go-genai',
        'imports': '"google.golang.org/genai"',
        'setup': 'client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: "benchmark", Backend: genai.BackendGeminiAPI, HTTPOptions: genai.HTTPOptions{BaseURL: endpoint}}); if err != nil { panic(err) }',
        'call': '''response, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text("Say hello."), &genai.GenerateContentConfig{MaxOutputTokens: 32})
        if err != nil { return "", err }
        return response.Text(), nil''',
    },
    'lm15': {
        'label': 'LM15', 'module': 'github.com/lm15-dev/lm15-go',
        'source': 'https://github.com/lm15-dev/lm15-go',
        'imports': 'lm15 "github.com/lm15-dev/lm15-go"',
        'setup': 'client, err := lm15.NewOpenAIChatLM(lm15.WithAPIKey("benchmark"), lm15.WithBaseURL(endpoint+"/v1")); if err != nil { panic(err) }; defer client.Close()',
        'call': '''response, err := client.Complete(ctx, &lm15.Request{Model: "gpt-4.1-mini", Messages: []lm15.Message{lm15.UserMessage("Say hello.")}, Config: lm15.Config{MaxTokens: lm15.I(32)}})
        if err != nil { return "", err }
        return response.TextOr(""), nil''',
    },
}

RUST_MAIN = r'''
use std::{env, time::Instant};
__IMPORTS__
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = env::var("LM15_BENCH_ENDPOINT")?;
    let iterations: usize = env::var("LM15_BENCH_ITERATIONS")?.parse()?;
    __SETUP__
    for _ in 0..20 {
        let text: String = { __CALL__ };
        assert_eq!(text, "Hello.");
        std::hint::black_box(text);
    }
    let started = Instant::now();
    for _ in 0..iterations {
        let text: String = { __CALL__ };
        assert_eq!(text, "Hello.");
        std::hint::black_box(text);
    }
    let request_us = started.elapsed().as_secs_f64() * 1e6 / iterations as f64;
    let status = std::fs::read_to_string("/proc/self/status")?;
    let rss: f64 = status.lines().find(|line| line.starts_with("VmRSS:")).ok_or("RSS")?.split_whitespace().nth(1).ok_or("RSS value")?.parse()?;
    let cpu = status.lines().find(|line| line.starts_with("Cpus_allowed_list:")).ok_or("affinity")?.split_whitespace().nth(1).ok_or("CPU value")?;
    println!("BENCH_RESULT={{\"request_us\":{request_us},\"rss_mib\":{},\"cpu_affinity\":\"{cpu}\",\"iterations\":{iterations}}}", rss / 1024.0);
    Ok(())
}
'''
GO_MAIN = r'''
package main
import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "strconv"
    "strings"
    "time"
    __IMPORTS__
)
func main() {
    ctx := context.Background()
    endpoint := os.Getenv("LM15_BENCH_ENDPOINT")
    iterations, err := strconv.Atoi(os.Getenv("LM15_BENCH_ITERATIONS")); if err != nil { panic(err) }
    __SETUP__
    call := func() (string, error) { __CALL__ }
    for i := 0; i < 20; i++ { text, err := call(); if err != nil { panic(err) }; if text != "Hello." { panic("incorrect reply") } }
    started := time.Now()
    for i := 0; i < iterations; i++ { text, err := call(); if err != nil { panic(err) }; if text != "Hello." { panic("incorrect reply") } }
    elapsed := float64(time.Since(started).Nanoseconds()) / 1000 / float64(iterations)
    status, err := os.ReadFile("/proc/self/status"); if err != nil { panic(err) }
    var rss float64; var cpu string
    for _, line := range strings.Split(string(status), "\n") {
        if strings.HasPrefix(line, "VmRSS:") { rss, err = strconv.ParseFloat(strings.Fields(line)[1], 64); if err != nil { panic(err) } }
        if strings.HasPrefix(line, "Cpus_allowed_list:") { cpu = strings.Fields(line)[1] }
    }
    result, err := json.Marshal(map[string]any{"request_us": elapsed, "rss_mib": rss/1024, "cpu_affinity": cpu, "iterations": iterations}); if err != nil { panic(err) }
    fmt.Println("BENCH_RESULT="+string(result))
}
'''


def render(case: dict, template: str) -> str:
    for token in ['imports', 'setup', 'call']:
        template = template.replace('__'+token.upper()+'__', case[token])
    return template
