//! Launch the native benchmark coordinator on the build server via rcargo run.
use std::process::{Command, ExitCode};
fn main() -> ExitCode {
    let status = Command::new("nix")
        .args(["shell", "nixpkgs#cmake", "nixpkgs#pkg-config", "--command", "python3", "runner.py"])
        .args(std::env::args().skip(1))
        .status()
        .expect("launch benchmark coordinator");
    ExitCode::from(status.code().unwrap_or(1) as u8)
}
