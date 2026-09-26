use lm15::{LMRouter, Message, Request};

// Dependencies: lm15, tokio (macros, rt-multi-thread)
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let router = LMRouter::new();
    let request = Request {
        model: "vertex:gemini-2.5-flash".into(),
        system: Some(concat!(
            "You are the field assistant for a wildlife research ",
            "station. Answer in two sentences.",
        ).into()),
        messages: vec![Message::user(concat!(
            "What might be eating the acorns under our oak trees at ",
            "night?",
        ))?],
        ..Default::default()
    };
    match router.complete(&request).await {
        Ok(response) => {
            println!("{}", response.text().unwrap_or_default())
        }
        Err(error) => println!("{error}"),
    }
    Ok(())
}
