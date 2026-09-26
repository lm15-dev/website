package main

import (
    "fmt"
    lm15 "github.com/lm15-dev/lm15-go"
)

func main() {
    report, err := lm15.ExplainAuth("vertex", lm15.ExplainOptions{})
    if err != nil {
        panic(err)
    }
    fmt.Println(report.Describe())
}
