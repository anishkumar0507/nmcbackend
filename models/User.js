import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: function() {
      // Password not required if user is auto-created from JWT
      return !this.isAutoCreated;
    },
    minlength: [6, 'Password must be at least 6 characters']
  },
  isAutoCreated: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function() {
  // Skip hashing if password hasn't been modified or if password is empty (auto-created user)
  if (!this.isModified('password') || !this.password) {
    return;
  }
  
  // Skip hashing if password already looks hashed (starts with $2b$)
  if (this.password.startsWith('$2b$')) {
    return;
  }
  
  // Hash password using bcrypt
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

const User = mongoose.model('User', userSchema);

export default User;

