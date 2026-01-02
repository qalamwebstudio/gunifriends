import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import LoginPage from './page';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('LoginPage', () => {
  const mockPush = jest.fn();
  const mockRouter = { push: mockPush };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (fetch as jest.Mock).mockClear();
    mockLocalStorage.setItem.mockClear();
  });

  describe('Form Rendering', () => {
    it('renders login form with all required fields', () => {
      render(<LoginPage />);
      
      expect(screen.getByRole('heading', { name: /sign in to your account/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
      expect(screen.getByText(/connect with fellow university students/i)).toBeInTheDocument();
    });

    it('renders additional UI elements', () => {
      render(<LoginPage />);
      
      expect(screen.getByLabelText(/remember me/i)).toBeInTheDocument();
      expect(screen.getByText(/forgot your password/i)).toBeInTheDocument();
      expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /create new account/i })).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('shows error when email is empty', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);
      
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });
    });

    it('shows error when password is empty', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'test@stanford.edu');
      
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      });
    });

    it('shows error for invalid email format', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      await user.type(emailInput, 'invalid-email');
      
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
      });
    });

    it('clears field errors when user starts typing', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      // Trigger validation error
      await user.click(submitButton);
      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });
      
      // Start typing to clear error
      await user.type(emailInput, 'test@stanford.edu');
      await waitFor(() => {
        expect(screen.queryByText(/email is required/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('submits form with valid credentials', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: true,
        json: async () => ({ token: 'mock-jwt-token', user: { id: '1', email: 'test@stanford.edu' } }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@stanford.edu',
          password: 'password123',
        }),
      });
    });

    it('stores token and redirects on successful login', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: true,
        json: async () => ({ token: 'mock-jwt-token', user: { id: '1', email: 'test@stanford.edu' } }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('authToken', 'mock-jwt-token');
        expect(mockPush).toHaveBeenCalledWith('/');
      });
    });

    it('shows loading state during submission', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: true,
        json: async () => ({ token: 'mock-jwt-token' }),
      };
      (fetch as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockResponse), 100)));
      
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      expect(screen.getByRole('button', { name: /signing in.../i })).toBeInTheDocument();
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Error Handling', () => {
    it('displays error for invalid credentials (401)', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid credentials' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'wrongpassword');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/invalid email or password. please try again./i)).toBeInTheDocument();
      });
    });

    it('displays error for unverified account (403)', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: false,
        status: 403,
        json: async () => ({ error: 'Email not verified' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/please verify your email address before logging in./i)).toBeInTheDocument();
      });
    });

    it('displays generic error for other server errors', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/internal server error/i)).toBeInTheDocument();
      });
    });

    it('displays network error for fetch failures', async () => {
      const user = userEvent.setup();
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/network error. please check your connection and try again./i)).toBeInTheDocument();
      });
    });
  });

  describe('User Interactions', () => {
    it('handles forgot password click', async () => {
      const user = userEvent.setup();
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      
      render(<LoginPage />);
      
      const forgotPasswordLink = screen.getByText(/forgot your password/i);
      await user.click(forgotPasswordLink);
      
      expect(alertSpy).toHaveBeenCalledWith('Forgot password functionality will be implemented in a future update.');
      
      alertSpy.mockRestore();
    });

    it('has correct link to registration page', () => {
      render(<LoginPage />);
      
      const registerLink = screen.getByRole('link', { name: /create new account/i });
      expect(registerLink).toHaveAttribute('href', '/register');
    });

    it('handles remember me checkbox', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);
      
      const rememberCheckbox = screen.getByLabelText(/remember me/i);
      expect(rememberCheckbox).not.toBeChecked();
      
      await user.click(rememberCheckbox);
      expect(rememberCheckbox).toBeChecked();
    });
  });

  describe('Accessibility', () => {
    it('has proper form labels and structure', () => {
      render(<LoginPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      
      expect(emailInput).toHaveAttribute('type', 'email');
      expect(emailInput).toHaveAttribute('autoComplete', 'email');
      expect(passwordInput).toHaveAttribute('type', 'password');
      expect(passwordInput).toHaveAttribute('autoComplete', 'current-password');
    });

    it('shows proper error styling for invalid fields', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);
      
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        const emailInput = screen.getByLabelText(/email address/i);
        expect(emailInput).toHaveClass('border-red-300');
      });
    });
  });
});