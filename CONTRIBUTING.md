# Contributing to MJ Forge

Thank you for your interest in contributing to MJ Forge! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/mj-forge.git`
3. Add the upstream remote: `git remote add upstream https://github.com/MemberJunction/mj-forge.git`

## Development Setup

### Prerequisites

- Node.js 20 or later
- npm 10 or later
- Xcode Command Line Tools (for native modules)
- Docker (optional, for local SQL Server testing)

### Installation

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
```

### Running SQL Server Locally

The easiest way to test is with Docker:

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong@Passw0rd" \
  -p 1433:1433 --name sql1 -d mcr.microsoft.com/mssql/server:2022-latest
```

## Project Structure

```
mj-forge/
├── packages/
│   ├── shared/      # Shared types, constants, validators
│   ├── preload/     # Electron preload script
│   ├── main/        # Electron main process
│   └── renderer/    # Angular UI application
├── resources/       # App icons and assets
├── plans/           # Planning documents
└── release/         # Build output
```

### Package Overview

- **@mj-forge/shared**: Type definitions, IPC channel constants, validators
- **@mj-forge/preload**: Electron preload script with contextBridge
- **@mj-forge/main**: Electron main process, SQL services, IPC handlers
- **@mj-forge/renderer**: Angular 18 UI with standalone components

## Making Changes

1. Create a branch from `main`:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following our [code style guidelines](#code-style)

3. Write or update tests for your changes

4. Run the test suite:

   ```bash
   npm test
   ```

5. Build to check for type errors:
   ```bash
   npm run build
   ```

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(backup): add compression option to backup dialog
fix(connection): handle timeout errors gracefully
docs(readme): add Docker setup instructions
refactor(explorer): use signals for state management
```

## Pull Request Process

1. Update documentation if needed
2. Ensure all tests pass
3. Ensure the build succeeds
4. Create a pull request with a clear description
5. Link any related issues

### PR Title Format

Use the same format as commits:

```
feat(scope): description
```

## Code Style

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Use type guards for narrowing

### Angular

- Use standalone components
- Use Angular signals for reactive state
- Use OnPush change detection
- Follow the smart/dumb component pattern

### File Naming

- Components: `kebab-case.component.ts`
- Services: `kebab-case.service.ts`
- Types: `kebab-case.types.ts`
- Tests: `*.spec.ts`

### Formatting

We use Prettier for formatting. Run before committing:

```bash
npm run format
```

Or let lint-staged handle it automatically on commit.

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions

Thank you for contributing!
