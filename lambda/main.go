package main

import (
	"context"

	"github.com/aws/aws-lambda-go/lambda"
)

func Handler(ctx context.Context) (string, error) {
	return "Hola Mundo desde Lambda en Go f1!", nil
}

func main() {
	lambda.Start(Handler)
}
