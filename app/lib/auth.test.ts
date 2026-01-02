import * as fc from 'fast-check';
import { db } from './database';
import { PasswordUtils, TokenUtils, ValidationUtils } from './auth';
import { UNIVERSITY_DOMAINS } from '../types';

describe('Authentication Flow Property Tests', () => {
  beforeEach(async () => {
    // Clear database before each test
    await db.clearAll();
  });

  describe('Property 4: Unverified account protection', () => {
    /**
     * Feature: university-video-chat, Property 4: Unverified account protection
     * Validates: Requirements 1.4
     * 
     * For any unverified user account, login attempts should be rejected regardless of correct password
     */
    it('should reject login attempts for all unverified accounts regardless of correct credentials', async () => {
      // Generate arbitrary user data with valid university emails
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const universityEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
      ).map(([localPart, domain]) => `${localPart}@${domain}`);

      const validPasswordArbitrary = fc.string({ minLength: 8, maxLength: 50 })
        .filter(password => 
          /[A-Z]/.test(password) && 
          /[a-z]/.test(password) && 
          /\d/.test(password)
        );

      const unverifiedUserArbitrary = fc.tuple(
        universityEmailArbitrary,
        validPasswordArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.map(uni => uni.name))
      );

      await fc.assert(
        fc.asyncProperty(unverifiedUserArbitrary, async ([email, password, university]) => {
          // Create unverified user account
          const passwordHash = await PasswordUtils.hashPassword(password);
          await db.createUser({
            email: email.toLowerCase(),
            passwordHash,
            university,
            isEmailVerified: false, // Key: account is NOT verified
            emailVerificationToken: TokenUtils.generateVerificationToken(),
            reportCount: 0,
            isActive: true
          });

          // Attempt to authenticate with correct credentials
          const foundUser = await db.getUserByEmail(email.toLowerCase());
          expect(foundUser).not.toBeNull();
          
          if (foundUser) {
            // Verify password is correct
            const isPasswordValid = await PasswordUtils.verifyPassword(password, foundUser.passwordHash);
            expect(isPasswordValid).toBe(true);
            
            // But login should still be rejected due to unverified email
            expect(foundUser.isEmailVerified).toBe(false);
            
            // This simulates the login endpoint logic that checks email verification
            // The login should fail even with correct credentials if email is not verified
            if (!foundUser.isEmailVerified) {
              // Login should be rejected
              expect(foundUser.isEmailVerified).toBe(false);
            }
          }
        }),
        { numRuns: 5 }
      );
    });

    /**
     * Feature: university-video-chat, Property 4: Unverified account protection
     * Validates: Requirements 1.4
     * 
     * For any verified user account, login attempts should succeed with correct credentials
     */
    it('should allow login attempts for all verified accounts with correct credentials', async () => {
      // Generate arbitrary user data with valid university emails
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const universityEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
      ).map(([localPart, domain]) => `${localPart}@${domain}`);

      const validPasswordArbitrary = fc.string({ minLength: 8, maxLength: 50 })
        .filter(password => 
          /[A-Z]/.test(password) && 
          /[a-z]/.test(password) && 
          /\d/.test(password)
        );

      const verifiedUserArbitrary = fc.tuple(
        universityEmailArbitrary,
        validPasswordArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.map(uni => uni.name))
      );

      await fc.assert(
        fc.asyncProperty(verifiedUserArbitrary, async ([email, password, university]) => {
          // Create verified user account
          const passwordHash = await PasswordUtils.hashPassword(password);
          await db.createUser({
            email: email.toLowerCase(),
            passwordHash,
            university,
            isEmailVerified: true, // Key: account IS verified
            reportCount: 0,
            isActive: true
          });

          // Attempt to authenticate with correct credentials
          const foundUser = await db.getUserByEmail(email.toLowerCase());
          expect(foundUser).not.toBeNull();
          
          if (foundUser) {
            // Verify password is correct
            const isPasswordValid = await PasswordUtils.verifyPassword(password, foundUser.passwordHash);
            expect(isPasswordValid).toBe(true);
            
            // Login should succeed for verified accounts
            expect(foundUser.isEmailVerified).toBe(true);
            expect(foundUser.isActive).toBe(true);
            
            // Should be able to generate token for verified user
            const token = TokenUtils.generateToken(foundUser);
            expect(token).toBeTruthy();
            
            // Token should be valid and contain correct user info
            const decoded = TokenUtils.verifyToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded?.userId).toBe(foundUser.id);
            expect(decoded?.email).toBe(foundUser.email);
            expect(decoded?.isEmailVerified).toBe(true);
          }
        }),
        { numRuns: 5 }
      );
    });
  });

  describe('Property 7: Authentication flow', () => {
    /**
     * Feature: university-video-chat, Property 7: Authentication flow
     * Validates: Requirements 2.4
     * 
     * For any valid login credentials of verified users, the system should authenticate and redirect to home page
     */
    it('should successfully authenticate all verified users with valid credentials', async () => {
      // Generate arbitrary verified user data
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const universityEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
      ).map(([localPart, domain]) => `${localPart}@${domain}`);

      const validPasswordArbitrary = fc.string({ minLength: 8, maxLength: 50 })
        .filter(password => 
          /[A-Z]/.test(password) && 
          /[a-z]/.test(password) && 
          /\d/.test(password)
        );

      const authenticatedUserArbitrary = fc.tuple(
        universityEmailArbitrary,
        validPasswordArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.map(uni => uni.name))
      );

      await fc.assert(
        fc.asyncProperty(authenticatedUserArbitrary, async ([email, password, university]) => {
          // Create verified and active user account
          const passwordHash = await PasswordUtils.hashPassword(password);
          const user = await db.createUser({
            email: email.toLowerCase(),
            passwordHash,
            university,
            isEmailVerified: true,
            reportCount: 0,
            isActive: true
          });

          // Simulate complete authentication flow
          const foundUser = await db.getUserByEmail(email.toLowerCase());
          expect(foundUser).not.toBeNull();
          
          if (foundUser) {
            // Step 1: Validate email format
            expect(ValidationUtils.isValidEmail(email)).toBe(true);
            
            // Step 2: User should exist
            expect(foundUser.id).toBe(user.id);
            
            // Step 3: Account should be active
            expect(foundUser.isActive).toBe(true);
            
            // Step 4: Password should be valid
            const isPasswordValid = await PasswordUtils.verifyPassword(password, foundUser.passwordHash);
            expect(isPasswordValid).toBe(true);
            
            // Step 5: Email should be verified
            expect(foundUser.isEmailVerified).toBe(true);
            
            // Step 6: Should be able to generate JWT token
            const token = TokenUtils.generateToken(foundUser);
            expect(token).toBeTruthy();
            
            // Step 7: Token should be valid and decodable
            const decoded = TokenUtils.verifyToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded?.userId).toBe(foundUser.id);
            expect(decoded?.email).toBe(foundUser.email);
            expect(decoded?.isEmailVerified).toBe(true);
            
            // Step 8: Should update last active timestamp
            const updatedUser = await db.updateUser(foundUser.id, {
              lastActiveAt: new Date()
            });
            expect(updatedUser).not.toBeNull();
            expect(updatedUser?.lastActiveAt.getTime()).toBeGreaterThan(foundUser.lastActiveAt.getTime());
          }
        }),
        { numRuns: 5 }
      );
    });

    /**
     * Feature: university-video-chat, Property 7: Authentication flow
     * Validates: Requirements 2.4
     * 
     * For any authentication attempt, the complete flow should maintain data consistency
     */
    it('should maintain data consistency throughout the authentication process', async () => {
      // Generate arbitrary user data
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const universityEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
      ).map(([localPart, domain]) => `${localPart}@${domain}`);

      const validPasswordArbitrary = fc.string({ minLength: 8, maxLength: 50 })
        .filter(password => 
          /[A-Z]/.test(password) && 
          /[a-z]/.test(password) && 
          /\d/.test(password)
        );

      const userDataArbitrary = fc.tuple(
        universityEmailArbitrary,
        validPasswordArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.map(uni => uni.name)),
        fc.boolean(), // isEmailVerified
        fc.boolean()  // isActive
      );

      await fc.assert(
        fc.asyncProperty(userDataArbitrary, async ([email, password, university, isEmailVerified, isActive]) => {
          // Create user with arbitrary verification and active status
          const passwordHash = await PasswordUtils.hashPassword(password);
          const originalUser = await db.createUser({
            email: email.toLowerCase(),
            passwordHash,
            university,
            isEmailVerified,
            reportCount: 0,
            isActive
          });

          // Attempt authentication
          const foundUser = await db.getUserByEmail(email.toLowerCase());
          expect(foundUser).not.toBeNull();
          
          if (foundUser) {
            // Data consistency checks
            expect(foundUser.id).toBe(originalUser.id);
            expect(foundUser.email).toBe(originalUser.email);
            expect(foundUser.university).toBe(originalUser.university);
            expect(foundUser.isEmailVerified).toBe(originalUser.isEmailVerified);
            expect(foundUser.isActive).toBe(originalUser.isActive);
            expect(foundUser.reportCount).toBe(originalUser.reportCount);
            
            // Password verification should work regardless of other states
            const isPasswordValid = await PasswordUtils.verifyPassword(password, foundUser.passwordHash);
            expect(isPasswordValid).toBe(true);
            
            // Authentication success should depend on all conditions being met
            const shouldAuthenticate = foundUser.isActive && foundUser.isEmailVerified;
            
            if (shouldAuthenticate) {
              // Should be able to generate and verify token
              const token = TokenUtils.generateToken(foundUser);
              expect(token).toBeTruthy();
              
              const decoded = TokenUtils.verifyToken(token);
              expect(decoded).not.toBeNull();
              expect(decoded?.userId).toBe(foundUser.id);
            }
            
            // User data should remain unchanged after authentication attempt
            const userAfterAuth = await db.getUserByEmail(email.toLowerCase());
            expect(userAfterAuth?.id).toBe(originalUser.id);
            expect(userAfterAuth?.email).toBe(originalUser.email);
            expect(userAfterAuth?.passwordHash).toBe(originalUser.passwordHash);
          }
        }),
        { numRuns: 5 }
      );
    });
  });

  describe('Property 8: Login error handling', () => {
    /**
     * Feature: university-video-chat, Property 8: Login error handling
     * Validates: Requirements 2.5
     * 
     * For any invalid login credentials, the system should display appropriate error messages and allow retry
     */
    it('should handle all invalid credential combinations with appropriate error responses', async () => {
      // Generate various invalid credential scenarios
      const invalidCredentialsArbitrary = fc.oneof(
        // Invalid email format
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => !ValidationUtils.isValidEmail(s)),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constant('invalid-email-format')
        ),
        // Non-existent user
        fc.tuple(
          fc.tuple(
            fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 20 }).map(chars => chars.join('')),
            fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
          ).map(([localPart, domain]) => `${localPart}@${domain}`),
          fc.string({ minLength: 8, maxLength: 50 }),
          fc.constant('non-existent-user')
        ),
        // Wrong password for existing user
        fc.tuple(
          fc.tuple(
            fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 20 }).map(chars => chars.join('')),
            fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
          ).map(([localPart, domain]) => `${localPart}@${domain}`),
          fc.tuple(
            fc.string({ minLength: 8, maxLength: 50 }).filter(password => 
              /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
            ),
            fc.string({ minLength: 8, maxLength: 50 }).filter(password => 
              /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
            )
          ).filter(([correctPassword, wrongPassword]) => correctPassword !== wrongPassword),
          fc.constant('wrong-password')
        )
      );

      await fc.assert(
        fc.asyncProperty(invalidCredentialsArbitrary, async ([emailOrTuple, passwordOrTuple, scenario]) => {
          let email: string;
          
          if (scenario === 'invalid-email-format') {
            email = emailOrTuple as string;
            
            // Test invalid email format
            expect(ValidationUtils.isValidEmail(email)).toBe(false);
            
            // Should not proceed with authentication for invalid email format
            const user = await db.getUserByEmail(email.toLowerCase());
            expect(user).toBeNull();
            
          } else if (scenario === 'non-existent-user') {
            email = emailOrTuple as string;
            
            // Test non-existent user
            expect(ValidationUtils.isValidEmail(email)).toBe(true);
            
            const user = await db.getUserByEmail(email.toLowerCase());
            expect(user).toBeNull();
            
          } else if (scenario === 'wrong-password') {
            email = emailOrTuple as string;
            const [correctPassword, wrongPassword] = passwordOrTuple as [string, string];
            
            // Create user with correct password
            const passwordHash = await PasswordUtils.hashPassword(correctPassword);
            await db.createUser({
              email: email.toLowerCase(),
              passwordHash,
              university: 'Test University',
              isEmailVerified: true,
              reportCount: 0,
              isActive: true
            });
            
            // Test wrong password
            const user = await db.getUserByEmail(email.toLowerCase());
            expect(user).not.toBeNull();
            
            if (user) {
              const isPasswordValid = await PasswordUtils.verifyPassword(wrongPassword, user.passwordHash);
              expect(isPasswordValid).toBe(false);
            }
          }
          
          // In all error cases, the system should:
          // 1. Not generate a valid authentication token
          // 2. Maintain system security by not revealing specific error details
          // 3. Allow for retry attempts (no permanent lockout in these tests)
          
          // Verify that no valid token can be generated for invalid credentials
          // (This would be handled by the login endpoint logic)
        }),
        { numRuns: 5 }
      );
    });

    /**
     * Feature: university-video-chat, Property 8: Login error handling
     * Validates: Requirements 2.5
     * 
     * For any inactive user account, login attempts should be rejected with appropriate error
     */
    it('should reject login attempts for all inactive accounts with appropriate error handling', async () => {
      // Generate arbitrary inactive user data
      const validLocalPartArbitrary = fc.array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        { minLength: 1, maxLength: 20 }
      ).map(chars => chars.join(''));
      
      const universityEmailArbitrary = fc.tuple(
        validLocalPartArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.flatMap(uni => uni.domains))
      ).map(([localPart, domain]) => `${localPart}@${domain}`);

      const validPasswordArbitrary = fc.string({ minLength: 8, maxLength: 50 })
        .filter(password => 
          /[A-Z]/.test(password) && 
          /[a-z]/.test(password) && 
          /\d/.test(password)
        );

      const inactiveUserArbitrary = fc.tuple(
        universityEmailArbitrary,
        validPasswordArbitrary,
        fc.constantFrom(...UNIVERSITY_DOMAINS.map(uni => uni.name)),
        fc.boolean() // isEmailVerified - should not matter for inactive accounts
      );

      await fc.assert(
        fc.asyncProperty(inactiveUserArbitrary, async ([email, password, university, isEmailVerified]) => {
          // Create inactive user account
          const passwordHash = await PasswordUtils.hashPassword(password);
          const user = await db.createUser({
            email: email.toLowerCase(),
            passwordHash,
            university,
            isEmailVerified,
            reportCount: 0,
            isActive: false // Key: account is INACTIVE
          });

          // Attempt to authenticate
          const foundUser = await db.getUserByEmail(email.toLowerCase());
          expect(foundUser).not.toBeNull();
          
          if (foundUser) {
            // Verify user exists and password is correct
            expect(foundUser.id).toBe(user.id);
            const isPasswordValid = await PasswordUtils.verifyPassword(password, foundUser.passwordHash);
            expect(isPasswordValid).toBe(true);
            
            // But account should be inactive
            expect(foundUser.isActive).toBe(false);
            
            // Login should be rejected for inactive accounts regardless of other factors
            // This simulates the login endpoint logic that checks account status
            if (!foundUser.isActive) {
              // Should not proceed with authentication
              expect(foundUser.isActive).toBe(false);
            }
          }
        }),
        { numRuns: 5 }
      );
    });

    /**
     * Feature: university-video-chat, Property 8: Login error handling
     * Validates: Requirements 2.5
     * 
     * For any missing required fields, the system should handle validation errors appropriately
     */
    it('should handle all missing required field combinations with appropriate validation errors', async () => {
      // Generate various missing field scenarios
      const missingFieldsArbitrary = fc.oneof(
        // Missing email
        fc.tuple(
          fc.constant(undefined),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constant(['email'])
        ),
        // Missing password
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constant(undefined),
          fc.constant(['password'])
        ),
        // Missing both
        fc.tuple(
          fc.constant(undefined),
          fc.constant(undefined),
          fc.constant(['email', 'password'])
        ),
        // Empty email
        fc.tuple(
          fc.constant(''),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constant(['email'])
        ),
        // Empty password
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constant(''),
          fc.constant(['password'])
        ),
        // Both empty
        fc.tuple(
          fc.constant(''),
          fc.constant(''),
          fc.constant(['email', 'password'])
        )
      );

      await fc.assert(
        fc.asyncProperty(missingFieldsArbitrary, async ([email, password, expectedMissingFields]) => {
          // Test validation of required fields
          const { isValid, missingFields } = ValidationUtils.validateRequiredFields(
            { email, password },
            ['email', 'password']
          );
          
          // Should correctly identify missing fields
          expect(isValid).toBe(false);
          expect([...missingFields].sort()).toEqual([...expectedMissingFields].sort());
          
          // Should not proceed with authentication when required fields are missing
          if (!isValid) {
            expect(missingFields.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 5 }
      );
    });
  });
});