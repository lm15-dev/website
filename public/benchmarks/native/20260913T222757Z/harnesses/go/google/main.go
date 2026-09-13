
package main
import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "strconv"
    "strings"
    "time"
    "google.golang.org/genai"
)
func main() {
    ctx := context.Background()
    endpoint := os.Getenv("LM15_BENCH_ENDPOINT")
    iterations, err := strconv.Atoi(os.Getenv("LM15_BENCH_ITERATIONS")); if err != nil { panic(err) }
    client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: "benchmark", Backend: genai.BackendGeminiAPI, HTTPOptions: genai.HTTPOptions{BaseURL: endpoint}}); if err != nil { panic(err) }
    call := func() (string, error) { response, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text("Say hello."), &genai.GenerateContentConfig{MaxOutputTokens: 32})
        if err != nil { return "", err }
        return response.Text(), nil }
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
