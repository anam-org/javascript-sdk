class PersonaConfig {
  final String? personaId;
  final String name;
  final String avatarId;
  final String voiceId;
  final String brainType;
  final String? systemPrompt;
  final int? maxSessionLengthSeconds;
  final String? languageCode;

  const PersonaConfig({
    this.personaId,
    required this.name,
    required this.avatarId,
    required this.voiceId,
    required this.brainType,
    this.systemPrompt,
    this.maxSessionLengthSeconds,
    this.languageCode,
  });

  Map<String, dynamic> toJson() {
    return {
      if (personaId != null) 'personaId': personaId,
      'name': name,
      'avatarId': avatarId,
      'voiceId': voiceId,
      'brainType': brainType,
      if (systemPrompt != null) 'systemPrompt': systemPrompt,
      if (maxSessionLengthSeconds != null)
        'maxSessionLengthSeconds': maxSessionLengthSeconds,
      if (languageCode != null) 'languageCode': languageCode,
    };
  }
}