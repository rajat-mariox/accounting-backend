const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['Administrator', 'Manager', 'Accountant'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    phone: { type: String, trim: true },
    role: { type: String, enum: ROLES, default: 'Accountant' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

userSchema.virtual('initials').get(function () {
  if (!this.name) return '';
  return this.name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
});

userSchema.virtual('roleTone').get(function () {
  switch (this.role) {
    case 'Administrator':
      return 'admin';
    case 'Manager':
      return 'manager';
    case 'Accountant':
    default:
      return 'accountant';
  }
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
