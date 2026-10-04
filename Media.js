import mongoose from 'mongoose';

// Photos envoyées depuis l'admin quand Cloudflare R2 n'est pas configuré (stockées dans MongoDB, servies par /media/:id)
const mediaSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', maxlength: 160 },
    mime: { type: String, required: true },
    size: { type: Number, default: 0 },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

export default mongoose.model('Media', mediaSchema);
