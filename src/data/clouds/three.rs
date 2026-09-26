use lm15::{LMRouter, Message, Request};

// Dependencies: lm15, tokio (macros, rt-multi-thread)
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let router = LMRouter::new();
    for model in [
        "bedrock-chat:deepseek.v3.2",
        "azure:gpt-4.1-mini",
        "vertex:gemini-2.5-flash",
    ] {
        let request = Request {
            model: model.into(),
            system: Some(concat!(
                "You are the field assistant for a wildlife research ",
                "station. Answer in two sentences.",
            ).into()),
            messages: vec![Message::user(concat!(
                "What might be eating the acorns under our oak trees ",
                "at night?",
            ))?],
            ..Default::default()
        };
        let response = router.complete(&request).await?;
        println!("{model}\n{}\n", response.text().unwrap_or_default());
    }
    Ok(())
}
