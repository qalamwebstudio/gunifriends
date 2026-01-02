import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import RegisterPage from './page';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

describe('RegisterPage', () => {
  const mockPush = jest.fn();
  const mockRouter = { push: mockPush };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (fetch as jest.Mock).mockClear();
  });

  describe('Form Rendering', () => {
    it('renders registration form with all required fields', () => {
      render(<RegisterPage />);
      
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/university email address/i)).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /university/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    });

    it('renders university dropdown with options', () => {
      render(<RegisterPage />);
      
      const universitySelect = screen.getByRole('combobox', { name: /university/i });
      expect(universitySelect).toBeInTheDocument();
      expect(screen.getByText(/select your university/i)).toBeInTheDocument();
      expect(screen.getByText(/stanford university/i)).toBeInTheDocument();
      expect(screen.getByText(/massachusetts institute of technology/i)).toBeInTheDocument();
    });

    it('renders password requirements and additional UI elements', () => {
      render(<RegisterPage />);
      
      expect(screen.getByText(/must be at least 8 characters with uppercase, lowercase, and number/i)).toBeInTheDocument();
      expect(screen.getByText(/already have an account/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /sign in to your account/i })).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('shows error when email is empty', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });
    });

    it('shows error for non-university email domain', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      await user.type(emailInput, 'test@gmail.com');
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/email must be from an approved university domain/i)).toBeInTheDocument();
      });
    });

    it('shows error when password is too short', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, '123');
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/password must be at least 8 characters long/i)).toBeInTheDocument();
      });
    });

    it('shows error when password lacks complexity', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'password');
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/password must contain at least one uppercase letter, one lowercase letter, and one number/i)).toBeInTheDocument();
      });
    });

    it('shows error when passwords do not match', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Password123');
      await user.type(confirmPasswordInput, 'Password456');
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });

    it('shows error when university is not selected', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Password123');
      await user.type(confirmPasswordInput, 'Password123');
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/please select your university/i)).toBeInTheDocument();
      });
    });

    it('clears field errors when user starts typing', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const submitButton = screen.getByRole('button', { name: /create account/i });
      
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

  describe('Auto-detection Features', () => {
    it('auto-detects university from email domain', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i }) as HTMLSelectElement;
      
      await user.type(emailInput, 'test@stanford.edu');
      
      expect(universitySelect.value).toBe('Stanford University');
    });

    it('handles email input for MIT domain', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i }) as HTMLSelectElement;
      
      await user.type(emailInput, 'student@mit.edu');
      
      expect(universitySelect.value).toBe('Massachusetts Institute of Technology');
    });
  });

  describe('Form Submission', () => {
    it('submits form with valid data', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: true,
        json: async () => ({ message: 'Registration successful' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i });
      const submitButton = screen.getByRole('button', { name: /create account/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Password123');
      await user.type(confirmPasswordInput, 'Password123');
      await user.selectOptions(universitySelect, 'Stanford University');
      await user.click(submitButton);
      
      expect(fetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@stanford.edu',
          password: 'Password123',
          university: 'Stanford University',
        }),
      });
    });

    it('shows success message and clears form on successful registration', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: true,
        json: async () => ({ message: 'Registration successful' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i) as HTMLInputElement;
      const universitySelect = screen.getByRole('combobox', { name: /university/i }) as HTMLSelectElement;
      const submitButton = screen.getByRole('button', { name: /create account/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Password123');
      await user.type(confirmPasswordInput, 'Password123');
      await user.selectOptions(universitySelect, 'Stanford University');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/registration successful! please check your email to verify your account./i)).toBeInTheDocument();
        expect(emailInput.value).toBe('');
        expect(passwordInput.value).toBe('');
        expect(confirmPasswordInput.value).toBe('');
        expect(universitySelect.value).toBe('');
      });
    });

    it('shows loading state during submission', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: true,
        json: async () => ({ message: 'Registration successful' }),
      };
      (fetch as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockResponse), 100)));
      
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i });
      const submitButton = screen.getByRole('button', { name: /create account/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Password123');
      await user.type(confirmPasswordInput, 'Password123');
      await user.selectOptions(universitySelect, 'Stanford University');
      await user.click(submitButton);
      
      expect(screen.getByRole('button', { name: /creating account.../i })).toBeInTheDocument();
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Error Handling', () => {
    it('displays server error message', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        ok: false,
        json: async () => ({ error: 'Email already exists' }),
      };
      (fetch as jest.Mock).mockResolvedValueOnce(mockResponse);
      
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i });
      const submitButton = screen.getByRole('button', { name: /create account/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Password123');
      await user.type(confirmPasswordInput, 'Password123');
      await user.selectOptions(universitySelect, 'Stanford University');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/email already exists/i)).toBeInTheDocument();
      });
    });

    it('displays network error for fetch failures', async () => {
      const user = userEvent.setup();
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i });
      const submitButton = screen.getByRole('button', { name: /create account/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Password123');
      await user.type(confirmPasswordInput, 'Password123');
      await user.selectOptions(universitySelect, 'Stanford University');
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/network error. please check your connection and try again./i)).toBeInTheDocument();
      });
    });
  });

  describe('User Interactions', () => {
    it('has correct link to login page', () => {
      render(<RegisterPage />);
      
      const loginLink = screen.getByRole('link', { name: /sign in to your account/i });
      expect(loginLink).toHaveAttribute('href', '/login');
    });

    it('handles university selection', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const universitySelect = screen.getByRole('combobox', { name: /university/i }) as HTMLSelectElement;
      
      await user.selectOptions(universitySelect, 'Harvard University');
      expect(universitySelect.value).toBe('Harvard University');
    });
  });

  describe('Accessibility', () => {
    it('has proper form labels and structure', () => {
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      
      expect(emailInput).toHaveAttribute('type', 'email');
      expect(emailInput).toHaveAttribute('autoComplete', 'email');
      expect(passwordInput).toHaveAttribute('type', 'password');
      expect(passwordInput).toHaveAttribute('autoComplete', 'new-password');
      expect(confirmPasswordInput).toHaveAttribute('type', 'password');
      expect(confirmPasswordInput).toHaveAttribute('autoComplete', 'new-password');
    });

    it('shows proper error styling for invalid fields', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        const emailInput = screen.getByLabelText(/university email address/i);
        expect(emailInput).toHaveClass('border-red-300');
      });
    });
  });

  describe('Password Validation Edge Cases', () => {
    it('accepts valid complex password', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'ValidPass123');
      await user.type(confirmPasswordInput, 'ValidPass123');
      await user.selectOptions(universitySelect, 'Stanford University');
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      // Should not show password validation errors
      expect(screen.queryByText(/password must be at least 8 characters long/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/password must contain at least one uppercase letter/i)).not.toBeInTheDocument();
    });

    it('validates password with special characters', async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      
      const emailInput = screen.getByLabelText(/university email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
      const universitySelect = screen.getByRole('combobox', { name: /university/i });
      
      await user.type(emailInput, 'test@stanford.edu');
      await user.type(passwordInput, 'Complex@Pass123');
      await user.type(confirmPasswordInput, 'Complex@Pass123');
      await user.selectOptions(universitySelect, 'Stanford University');
      
      const submitButton = screen.getByRole('button', { name: /create account/i });
      await user.click(submitButton);
      
      // Should not show password validation errors
      expect(screen.queryByText(/password must contain at least one uppercase letter/i)).not.toBeInTheDocument();
    });
  });
});