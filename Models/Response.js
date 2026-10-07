const mongoose = require("mongoose");

const responseSchema = new mongoose.Schema({
    survey: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Survey",
        required: true
    },
    answers: [{
        question: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Question",
            required: true
        },
        value: {
            type: String,
            required: true,
            trim: true
        }
    }]
}, { timestamps: true });

module.exports = mongoose.model("Response", responseSchema);