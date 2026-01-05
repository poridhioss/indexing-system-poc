# Introduction to Codestral and FIM

In this lab, you'll learn the fundamentals of AI-powered code completion. We'll set up Codestral—Mistral AI's specialized code completion model—and make your first FIM (Fill-In-Middle) API requests.

By the end of this lab, you'll understand how modern `AI Powered`code editors like `Poridhi's` **PUKU-VS-Editor** generate inline code suggestions.

## Prequisites
- Basic command line knowledge
- `curl` installed (comes with most systems)
- A Mistral account (you'll create one in this lab)

## Project Overview

This lab is part of a series on building a production-ready code completion system with intelligent caching.

Modern AI code completion relies on Large Language Models (LLMs) to generate suggestions. While these models produce high-quality completions, each API call takes 300-800ms—too slow for real-time typing. This series solves that problem through strategic caching.

In **Lab 1**, you'll set up the `Codestral API` and understand how `FIM` (Fill-In-Middle) completion works. In **Lab 2**, you'll build an AWS Lambda backend that handles API calls to the LLM, creating a serverless infrastructure for code completion. In **Lab 3**, you'll implement a Radix Trie cache that stores completions by prefix, enabling instant responses as users continue typing. In **Lab 4**, you'll add speculative caching that pre-fetches likely next completions when users accept a suggestion, achieving near-zero latency for the entire coding flow.

**Without caching**, every keystroke triggers a new API call to the LLM, resulting in 300-800ms delays per request.

![Without Caching - Direct API Calls](./images/infra-1.svg)

**With caching**, every request first checks the cache. On a cache miss, the system makes an API call to the LLM and stores the result. On subsequent keystrokes, the cache returns an immediate response without waiting for the LLM.

![With Caching - Cache-First Architecture](./images/infra-2.svg)

The result is a code completion system that feels instantaneous, despite relying on a remote LLM API.

## Lab Overview

**What You'll Learn**:
1. What Codestral is and why it's optimized for code
2. How FIM (Fill-In-Middle) works at a conceptual level
3. How LLMs process code completion requests
4. Setting up your Mistral account and API key
5. Making API requests to generate code completions

## Understanding Code Completion with LLMs

Before diving into the setup, let's understand how AI-powered code completion actually works.

### Traditional Autocompletion vs AI Completion

**Traditional IDE Autocompletion**:
- Uses static analysis and symbol tables
- Suggests variable names, method names from current scope
- Limited to what's already defined in your codebase

**AI-Powered Completion**:
- Uses Large Language Models (LLMs) trained on billions of lines of code
- Understands patterns, idioms, and context
- Can generate entire function bodies, not just names

### How LLMs Process Code

When you request a code completion, the LLM processes your input through four stages: tokenization breaks code into tokens, embedding converts them to vectors, attention analyzes context, and generation predicts the next tokens.

![LLM Processing Pipeline](./images/infra-3.svg)

## What is Codestral?

<p align="center">
  <img src="./images/image-4.png" alt="Codestral Logo" width="350"/>
</p>

**Codestral** is Mistral AI's specialized model built specifically for code completion. Unlike general-purpose LLMs that are trained on mixed content (text, web pages, books), Codestral is trained primarily on code, making it highly effective at understanding programming patterns and syntax.

The model uses `codestral-latest` as its identifier and offers a massive 256,000 token context window—twice the size of most general LLMs. This means it can analyze your entire file or even multiple files at once to provide more accurate completions.

What sets Codestral apart is its native FIM (Fill-In-Middle) support. While models like GPT-4 or Claude require prompt engineering to handle fill-in-the-middle scenarios, Codestral understands prefix and suffix inputs natively. It's also optimized for low latency, making it ideal for real-time code completion where every millisecond counts.

Codestral understands code structure intuitively—it knows that after `def function_name():` comes an indented body, and after `if condition:` comes a block. Best of all, Mistral offers a free tier, making it accessible for experimentation and development.

## What is FIM (Fill-In-Middle)?

FIM is the technique that makes modern code completion feel "magical." Instead of just predicting what comes next, FIM fills in code **between** existing code.

**The problem with traditional completion:** Traditional language models only see what comes before the cursor. If you type `def add(a, b):` and ask for a completion, the model might generate `return a + b` followed by an entirely new function, then another, and keep going. It doesn't know when to stop because it can't see what comes after your cursor.

**The FIM solution:** FIM provides context from both sides of the cursor. You send the model a **prefix** (code before the cursor) and a **suffix** (code after the cursor). The model then generates only the code that fits between them. Because it can see what comes next, it knows exactly where to stop.

### Visual Example in Practice

Imagine you're editing this Python file:

```python
# calculator.py

def add(a, b):
    |  # ← Your cursor is here

def subtract(a, b):
    return a - b

result = add(10, 5)
print(f"Sum: {result}")
```

**What the FIM API receives**:

| Component | Content |
|-----------|---------|
| **Prefix** | `# calculator.py\n\ndef add(a, b):\n    ` |
| **Suffix** | `\n\ndef subtract(a, b):\n    return a - b\n\nresult = add(10, 5)\nprint(f"Sum: {result}")` |

**What the model generates**: `return a + b`

The model sees:
1. The function is named `add` with parameters `a, b`
2. There's a `subtract` function below that returns `a - b`
3. The function is called with `add(10, 5)` expecting a sum

With all this context, it confidently generates `return a + b`.

### Why FIM is Superior

| Aspect | Traditional | FIM |
|--------|-------------|-----|
| **Context** | Only sees before cursor | Sees before AND after |
| **Accuracy** | May generate irrelevant code | Fits naturally into existing code |
| **Stop condition** | Unclear when to stop | Knows to stop at suffix |
| **Use case** | Only end of file | Anywhere in file |
| **Quality** | Generic completions | Context-aware completions |

## Step-by-Step Setup Guide

Now let's set up your Codestral API access to see the `FIM` magic in action.

### Step 1: Create a Mistral Account

1. Navigate to **https://console.mistral.ai/**

2. You'll see the login page with multiple sign-in options:

![Mistral Login Page](./images/image-1.png)

3. Choose your preferred sign-in method (Google, GitHub, or Email) and complete the registration process.

### Step 2: Navigate to Codestral

After logging in, navigate to the Codestral section to get your API key:

1. Go to **https://codestral.mistral.ai/** or look at the **left sidebar** and click on **"Codestral"** under the Code section

2. If this is your first time, you'll see a "Preview Access" page. Click **"Request Access"** to join the queue. Also if it ask for subscription plan, select the **Free Plan**.

![Codestral Preview Access](./images/image-6.png)

### Step 3: Generate Your Codestral API Key

Once you have access, you'll see the Codestral dashboard with API Key and Endpoints sections:

1. Click the **"Generate API Key"** button (orange button)

2. Your API key will be generated and displayed

![Codestral API Key Page](./images/image-7.png)

3. **Important**: Copy your API key immediately and store it securely.

The page also shows the available endpoints:
- **Completion Endpoint**: `https://codestral.mistral.ai/v1/fim/completions`
- **Chat Endpoint**: `https://codestral.mistral.ai/v1/chat/completions`

> **Security Note**: Never commit API keys to version control. Use environment variables in production.

### Step 4: Set Up Your Environment

For convenience, export your API key as an environment variable:

```bash
export MISTRAL_API_KEY="your-api-key-here"
```

To make this permanent, add it to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
echo 'export MISTRAL_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

### Step 5: Understand the API Endpoint

We'll use the **Codestral FIM Completion** endpoint at `https://codestral.mistral.ai/v1/fim/completions` with the API key generated in Step 3. This endpoint is specifically designed for fill-in-middle code completion and works with your Codestral API key.

## Making API Requests

Now let's make some actual API calls to see Codestral in action.

### Your First FIM Request

Open your terminal and run:

```bash
curl -X POST https://codestral.mistral.ai/v1/fim/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{
    "model": "codestral-latest",
    "prompt": "def calculate_sum(a, b):\n    ",
    "suffix": "\n\nresult = calculate_sum(5, 3)\nprint(result)",
    "max_tokens": 50,
    "temperature": 0.2
  }' | jq
```

### Understanding the Response

You should receive a response like this:

![API Response Example](./images/image-8.png)

**Key Response Fields**:

| Field | Description |
|-------|-------------|
| `choices[0].text` | The generated code completion |
| `finish_reason` | Why generation stopped (`stop` = natural end, `length` = hit max_tokens) |
| `usage.prompt_tokens` | Tokens in your prefix + suffix |
| `usage.completion_tokens` | Tokens generated |
| `usage.total_tokens` | Total for billing |

## Language-Specific Examples

Let's test Codestral with different programming languages.

### Example 1: Python - Class Initialization

```bash
curl -X POST https://codestral.mistral.ai/v1/fim/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{
    "model": "codestral-latest",
    "prompt": "class User:\n    def __init__(self, name, email, age):\n        ",
    "suffix": "\n\n    def get_info(self):\n        return f\"{self.name} ({self.email})\"",
    "max_tokens": 100,
    "temperature": 0.2
  }' | jq
```

**Expected Output**:

![Python Class Initialization Output](./images/image-9.png)

The model understands:
- Constructor parameters should be assigned to instance variables
- The `get_info` method references `self.name` and `self.email`, confirming these should exist

### Example 2: JavaScript - Array Processing

```bash
curl -X POST https://codestral.mistral.ai/v1/fim/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{
    "model": "codestral-latest",
    "prompt": "function filterAdults(users) {\n    ",
    "suffix": "\n}\n\nconst adults = filterAdults(users);\nconsole.log(`Found ${adults.length} adults`);",
    "max_tokens": 50,
    "temperature": 0.2
  }' | jq
```

![JavaScript Array Processing Output](./images/image-10.png)

The model infers:
- Function name `filterAdults` suggests filtering by age
- Return value is used with `.length`, so it should return an array
- Common pattern: `filter` with age >= 18

### Example 3: TypeScript - Interface Implementation

```bash
curl -X POST https://codestral.mistral.ai/v1/fim/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{
    "model": "codestral-latest",
    "prompt": "interface Product {\n    id: string;\n    name: string;\n    price: number;\n}\n\nfunction createProduct(id: string, name: string, price: number): Product {\n    ",
    "suffix": "\n}\n\nconst laptop = createProduct(\"001\", \"MacBook Pro\", 2499);",
    "max_tokens": 50,
    "temperature": 0.2
  }' | jq
```

**Expected Output**:
```typescript
return { id, name, price };
```

The model understands:
- Return type is `Product` interface
- Parameters match interface properties exactly
- ES6 shorthand property syntax is idiomatic

### Example 4: Python - Error Handling

```bash
curl -X POST https://codestral.mistral.ai/v1/fim/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{
    "model": "codestral-latest",
    "prompt": "def divide(a, b):\n    ",
    "suffix": "\n\ntry:\n    result = divide(10, 0)\nexcept ZeroDivisionError:\n    print(\"Cannot divide by zero\")",
    "max_tokens": 80,
    "temperature": 0.2
  }' | jq
```

**Expected Output**:

![JavaScript Async/Await Output](./images/image-11.png)

The model sees the `except ZeroDivisionError` block and knows the function should raise this specific exception.

### Example 5: JavaScript - Async/Await

```bash
curl -X POST https://codestral.mistral.ai/v1/fim/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{
    "model": "codestral-latest",
    "prompt": "async function fetchUser(userId) {\n    ",
    "suffix": "\n}\n\nconst user = await fetchUser(123);\nconsole.log(user.name);",
    "max_tokens": 100,
    "temperature": 0.2
  }' | jq
```
**Expected Output**:
It should generate code that uses `await` to fetch user data and handle the response.

## API Parameters Reference

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `model` | string | Yes | - | Model ID (`codestral-latest`) |
| `prompt` | string | Yes | - | Code before cursor (prefix) |
| `suffix` | string | No | `""` | Code after cursor |
| `max_tokens` | number | No | 100 | Maximum tokens to generate |
| `temperature` | number | No | 0.2 | Randomness (0.0-1.0) |

### Temperature Guide

| Value | Behavior | Best For |
|-------|----------|----------|
| **0.0** | Deterministic, identical outputs | Production systems |
| **0.2** | Slight variation, predictable | Code completion (recommended) |
| **0.5** | Moderate creativity | Exploring alternatives |
| **0.8+** | High creativity | Brainstorming, prototyping |

For code completion, **0.2 is recommended**. Code needs to be syntactically correct and predictable.

## Conclusion

In this lab, you learned:

- **What Codestral is**: Mistral AI's specialized code completion model optimized for FIM
- **How FIM works**: Using prefix + suffix to provide bidirectional context
- **How LLMs process code**: Tokenization, embedding, attention, and generation
- **API setup**: Creating a Mistral account and obtaining your API key
- **Making requests**: Using curl to generate completions in Python, JavaScript, and TypeScript

## The Caching Problem

You might have noticed that each API request takes 200-800ms. In a real code editor, users type continuously, and waiting 300ms+ for each keystroke would feel sluggish.

**This is where caching becomes essential.**

### What's Next

In **Lab 2: Radix Trie Cache**, we'll solve the typing latency problem: