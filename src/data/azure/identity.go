package main

import (
    "context"
    "fmt"
    "github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
    "github.com/Azure/azure-sdk-for-go/sdk/azidentity"
    lm15 "github.com/lm15-dev/lm15-go"
)

func main() {
    azure, err := azidentity.NewAzureCLICredential(nil)
    if err != nil {
        panic(err)
    }
    scope := policy.TokenRequestOptions{
        Scopes: []string{"https://ai.azure.com/.default"},
    }
    token := func(ctx context.Context) (lm15.Credential, error) {
        t, err := azure.GetToken(ctx, scope)
        return lm15.BearerToken{Value: t.Token}, err
    }
    router, err := lm15.NewRouterWithConfig(lm15.RouterConfig{
        APIKeys: map[string]lm15.CredentialLike{"azure": token},
    })
    if err != nil {
        panic(err)
    }
    request := &lm15.Request{
        Model:  "azure:gpt-4.1-mini",
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
