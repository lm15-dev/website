package main

import (
    "context"
    "fmt"
    "os"
    lm15 "github.com/lm15-dev/lm15-go"
)

func main() {
    key := os.Getenv("VERTEX_API_KEY")
    router, err := lm15.NewRouterWithConfig(lm15.RouterConfig{
        APIKeys: map[string]lm15.CredentialLike{"vertex": key},
        Settings: map[string]map[string]string{
            "vertex": {"location": "europe-west4"},
        },
    })
    if err != nil {
        panic(err)
    }
    request := &lm15.Request{
        Model:  "vertex:gemini-2.5-flash",
        System: lm15.System(
            "You are the field assistant for a wildlife research " +
            "station. Answer in two sentences.",
        ),
        Messages: []lm15.Message{
            lm15.UserMessage(
                "What might be eating the acorns under our oak trees " +
                "at night?",
            ),
        },
    }
    response, err := router.Complete(context.Background(), request)
    if err != nil {
        panic(err)
    }
    fmt.Println(response.TextOr(""))
}
