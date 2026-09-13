
use std::{env, time::Instant};
use rig_core::{client::CompletionClient, completion::{AssistantContent, CompletionModel}, providers::openai};
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = env::var("LM15_BENCH_ENDPOINT")?;
    let iterations: usize = env::var("LM15_BENCH_ITERATIONS")?.parse()?;
    let client = openai::Client::builder().api_key("benchmark").base_url(format!("{endpoint}/v1")).build()?.completions_api();
        let model = client.completion_model("gpt-4.1-mini");
    for _ in 0..20 {
        let text: String = { let request = model.completion_request("Say hello.").max_tokens(32).build();
        let response = model.completion(request).await?;
        let mut text = String::new();
        for item in response.choice { if let AssistantContent::Text(part) = item { text.push_str(&part.text); } }
        text };
        assert_eq!(text, "Hello.");
        std::hint::black_box(text);
    }
    let started = Instant::now();
    for _ in 0..iterations {
        let text: String = { let request = model.completion_request("Say hello.").max_tokens(32).build();
        let response = model.completion(request).await?;
        let mut text = String::new();
        for item in response.choice { if let AssistantContent::Text(part) = item { text.push_str(&part.text); } }
        text };
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
