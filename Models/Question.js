const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
    survey: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Survey",
        required: true
    },
    text: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ["text", "single-choice"],
        required: true
    },
    options: {
        type: [String],
        default: []
    }
}, { timestamps: true });

module.exports = mongoose.model("Question", questionSchema);