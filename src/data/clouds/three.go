package main

import (
    "context"
    "fmt"
    lm15 "github.com/lm15-dev/lm15-go"
)

func main() {
    router := lm15.NewRouter()
    for _, model := range []string{
        "bedrock-chat:deepseek.v3.2",
        "azure:gpt-4.1-mini",
        "vertex:gemini-2.5-flash",
    } {
        request := &lm15.Request{
            Model:  model,
            System: lm15.System(
                "You are the field assistant for a wildlife research " +
                "station. Answer in two sentences.",
            ),
            Messages: []lm15.Message{
                lm15.UserMessage(
                    "What might be eating the acorns under our oak " +
                    "trees at night?",
                ),
            },
        }
        response, err := router.Complete(context.Background(), request)
        if err != nil {
            panic(err)
        }
        fmt.Printf("%s\n%s\n\n", model, response.TextOr(""))
    }
}
