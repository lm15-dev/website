
use std::{env, time::Instant};
use genai::{Client, ModelSpec, ModelIden, ServiceTarget, adapter::AdapterKind, chat::{ChatRequest, ChatMessage}, resolver::{AuthData, Endpoint}};
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = env::var("LM15_BENCH_ENDPOINT")?;
    let iterations: usize = env::var("LM15_BENCH_ITERATIONS")?.parse()?;
    let client = Client::default();
        let model = ModelSpec::Target(ServiceTarget { model: ModelIden::from_static(AdapterKind::OpenAI, "gpt-4.1-mini"), endpoint: Endpoint::from_owned(format!("{endpoint}/v1/")), auth: AuthData::Key("benchmark".into()) });
    for _ in 0..20 {
        let text: String = { let request = ChatRequest::new(vec![ChatMessage::user("Say hello.")]);
        let response = client.exec_chat(model.clone(), request, Some(&genai::chat::ChatOptions::default().with_max_tokens(32))).await?;
        response.content.into_joined_texts().unwrap_or_default() };
        assert_eq!(text, "Hello.");
        std::hint::black_box(text);
    }
    let started = Instant::now();
    for _ in 0..iterations {
        let text: String = { let request = ChatRequest::new(vec![ChatMessage::user("Say hello.")]);
        let response = client.exec_chat(model.clone(), request, Some(&genai::chat::ChatOptions::default().with_max_tokens(32))).await?;
        response.content.into_joined_texts().unwrap_or_default() };
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
