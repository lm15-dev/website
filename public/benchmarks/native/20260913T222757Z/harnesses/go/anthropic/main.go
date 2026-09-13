
package main
import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "strconv"
    "strings"
    "time"
    anthropic "github.com/anthropics/anthropic-sdk-go"
"github.com/anthropics/anthropic-sdk-go/option"
)
func main() {
    ctx := context.Background()
    endpoint := os.Getenv("LM15_BENCH_ENDPOINT")
    iterations, err := strconv.Atoi(os.Getenv("LM15_BENCH_ITERATIONS")); if err != nil { panic(err) }
    client := anthropic.NewClient(option.WithAPIKey("benchmark"), option.WithBaseURL(endpoint), option.WithMaxRetries(0))
    call := func() (string, error) { response, err := client.Messages.New(ctx, anthropic.MessageNewParams{
            Model: "claude-haiku-4-5", MaxTokens: 32,
            Messages: []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("Say hello."))},
        })
        if err != nil { return "", err }; if len(response.Content) != 1 { return "", fmt.Errorf("missing content") }
        return response.Content[0].Text, nil }
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
