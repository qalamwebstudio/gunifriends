# University Video Chat

A university-exclusive video chat web application that connects students randomly for one-on-one video conversations, similar to Omegle but restricted to verified university email addresses.

## Features

- 🎓 University email authentication
- 📹 WebRTC peer-to-peer video chat
- 🔀 Random student matching
- 🛡️ User reporting and safety features
- 📱 Responsive web interface
- 🔒 Secure session management

## Tech Stack

- **Frontend**: Next.js 16 with TypeScript
- **Real-time Communication**: Socket.io + WebRTC
- **Authentication**: JWT tokens
- **Styling**: Tailwind CSS
- **Testing**: Jest + fast-check (property-based testing)

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local with your configuration
   ```

4. Run the development server:
   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

## Project Structure

```
app/
├── api/                 # API routes
│   ├── auth/           # Authentication endpoints
│   ├── reports/        # Reporting endpoints
│   └── socket/         # Socket.io server
├── components/         # React components
├── lib/               # Utility libraries
├── types/             # TypeScript type definitions
├── utils/             # Helper functions
├── register/          # Registration page
├── login/             # Login page
├── chat/              # Video chat interface
└── globals.css        # Global styles
```

## Development

This project follows a spec-driven development approach with comprehensive testing:

- **Unit Tests**: Specific examples and edge cases
- **Property-Based Tests**: Universal properties across all inputs
- **Integration Tests**: End-to-end user flows

## Contributing

1. Follow the existing code style
2. Write tests for new features
3. Ensure all tests pass before submitting
4. Update documentation as needed

## License

This project is for educational purposes.
