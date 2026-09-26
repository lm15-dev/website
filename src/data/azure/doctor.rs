use lm15::auth::explain_auth;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let report = explain_auth("azure", &Default::default())?;
    println!("{}", report.describe());
    Ok(())
}
