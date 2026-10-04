import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    email: { type: String, required: true, maxlength: 120 },
    // Texte complet affiché dans l'admin (description + téléphone, société, budget…)
    message: { type: String, required: true, maxlength: 6000 },
    // Champs d'origine du formulaire (téléphone, société, site, budget, échéance, services…)
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false },
);

export default mongoose.model('Message', messageSchema);
