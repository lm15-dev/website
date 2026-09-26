package main

import (
    "context"
    "fmt"
    lm15 "github.com/lm15-dev/lm15-go"
)

func main() {
    router := lm15.NewRouter()
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
        fmt.Println(err)
        return
    }
    fmt.Println(response.TextOr(""))
}
